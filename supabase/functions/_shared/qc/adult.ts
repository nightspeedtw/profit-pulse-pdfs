// Adult-track QC gates. Re-export the existing gate suite so orchestrators
// import a single track-scoped module.
export {
  TH, logRun,
  scoreTopic, topicGate, rewriteTopic,
  scoreOutline, outlineGate,
  scoreChapter, chapterGate, rewriteChapter,
  scoreEditorial,
  scoreProductCopy, productCopyGate,
  publishGate,
} from "../qc.ts";
