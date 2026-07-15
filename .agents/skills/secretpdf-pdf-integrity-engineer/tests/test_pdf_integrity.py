"""Unit tests for the deterministic PDF integrity scripts.

Builds tiny synthetic PDFs with reportlab, then invokes each detector and
asserts the verdict. Run with: pytest .agents/skills/secretpdf-pdf-integrity-engineer/tests/
"""
import io, json, os, subprocess, sys, tempfile, pathlib
import pytest
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import letter

SCRIPTS = pathlib.Path(__file__).resolve().parent.parent / "scripts"

def _run(script: str, *args) -> tuple[int, dict]:
    r = subprocess.run(
        [sys.executable, str(SCRIPTS / script), *args],
        capture_output=True, text=True,
    )
    try: v = json.loads(r.stdout.strip().splitlines()[-1])
    except Exception: v = {"_stdout": r.stdout, "_stderr": r.stderr}
    return r.returncode, v

def _make_pdf(pages_text: list[str], out: str) -> None:
    c = canvas.Canvas(out, pagesize=letter)
    for t in pages_text:
        c.drawString(72, 720, t or "")
        c.showPage()
    c.save()

@pytest.fixture()
def tmpdir_cwd(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    return tmp_path

def test_validate_pdf_bytes_pass(tmpdir_cwd):
    p = str(tmpdir_cwd / "ok.pdf"); _make_pdf(["hello world"], p)
    code, v = _run("validate-pdf-bytes.py", p)
    assert code == 0 and v["ok"] is True and v["page_count"] == 1

def test_validate_pdf_bytes_fail_on_non_pdf(tmpdir_cwd):
    p = tmpdir_cwd / "junk.pdf"; p.write_bytes(b"not a pdf")
    code, v = _run("validate-pdf-bytes.py", str(p))
    assert code == 1 and v["ok"] is False

def test_duplicate_pages_detected(tmpdir_cwd):
    dup_text = "The cub tiptoed into the kitchen and reached for the jam jar with a giggle." * 3
    p = str(tmpdir_cwd / "dup.pdf")
    _make_pdf([dup_text, "unique page two words words words words words", dup_text], p)
    code, v = _run("detect-duplicate-pages.py", p)
    assert code == 1 and v["duplicate_text_blocks"] >= 1

def test_duplicate_pages_clean(tmpdir_cwd):
    p = str(tmpdir_cwd / "clean.pdf")
    _make_pdf([f"page {i} unique content lorem ipsum dolor sit amet consectetur" for i in range(5)], p)
    code, v = _run("detect-duplicate-pages.py", p)
    assert code == 0 and v["duplicate_text_blocks"] == 0

def test_raw_markdown_and_html_comment_detected(tmpdir_cwd):
    p = str(tmpdir_cwd / "md.pdf")
    _make_pdf([
        "**bold text should not be in a printed book**",
        "<!-- page 1 --> leaked internal comment",
        "Story rule: never lecture the reader",
    ], p)
    code, v = _run("detect-raw-markdown.py", p)
    assert code == 1
    assert v["raw_markdown"] >= 1
    assert v["html_comments"] >= 1
    assert v["internal_brief_leak"] >= 1

def test_raw_markdown_clean(tmpdir_cwd):
    p = str(tmpdir_cwd / "cleanmd.pdf")
    _make_pdf(["Once upon a time a small bear cub tiptoed into a warm kitchen."], p)
    code, v = _run("detect-raw-markdown.py", p)
    assert code == 0
    assert v["raw_markdown"] == 0 and v["html_comments"] == 0

def test_metadata_derived_from_bytes(tmpdir_cwd):
    p = str(tmpdir_cwd / "meta.pdf")
    _make_pdf(["front", "title", "copyright"] + ["word " * 30 for _ in range(10)] + ["closing"], p)
    exp = tmpdir_cwd / "exp.json"
    exp.write_text(json.dumps({"page_count": 14, "read_aloud_minutes": 2.0}))
    code, v = _run("derive-final-metadata.py", p, "--expected", str(exp),
                   "--front-matter", "3", "--closing", "1", "--bonus", "0")
    assert v["page_count"] == 14
    # Metadata mismatch behavior depends on expected values matching derived ones
    assert "metadata_mismatches" in v

def test_page_order_ok(tmpdir_cwd):
    p = str(tmpdir_cwd / "order.pdf"); _make_pdf(["a","b","c","d","e"], p)
    code, v = _run("validate-page-order.py", p, "--front-matter", "0",
                   "--closing", "0", "--expected-story-pages", "5")
    assert code == 0 and v["ok"] is True
