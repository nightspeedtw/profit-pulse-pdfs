
-- Runtime skill registry + usage log
CREATE TABLE public.runtime_skill_contracts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  skill_key TEXT NOT NULL,
  skill_version TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  supported_book_types TEXT[] NOT NULL DEFAULT '{}',
  supported_pipeline_stages TEXT[] NOT NULL DEFAULT '{}',
  trigger_tags TEXT[] NOT NULL DEFAULT '{}',
  required_predecessor_skills TEXT[] NOT NULL DEFAULT '{}',
  prompt_contract JSONB NOT NULL DEFAULT '{}'::jsonb,
  reference_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
  qc_requirements JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (skill_key, skill_version)
);
GRANT SELECT ON public.runtime_skill_contracts TO authenticated, anon;
GRANT ALL ON public.runtime_skill_contracts TO service_role;
ALTER TABLE public.runtime_skill_contracts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "runtime_skill_contracts readable"
  ON public.runtime_skill_contracts FOR SELECT
  USING (true);
CREATE POLICY "runtime_skill_contracts admin write"
  ON public.runtime_skill_contracts FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER runtime_skill_contracts_updated
  BEFORE UPDATE ON public.runtime_skill_contracts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.run_skill_usage (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  run_id UUID,
  book_id UUID,
  stage TEXT NOT NULL,
  skill_key TEXT NOT NULL,
  skill_version TEXT NOT NULL,
  loaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  input_reference_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  output_asset_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  pass_fail_result TEXT NOT NULL DEFAULT 'pending',
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX run_skill_usage_run_idx ON public.run_skill_usage (run_id);
CREATE INDEX run_skill_usage_book_idx ON public.run_skill_usage (book_id);
CREATE INDEX run_skill_usage_stage_idx ON public.run_skill_usage (stage);
GRANT SELECT ON public.run_skill_usage TO authenticated;
GRANT ALL ON public.run_skill_usage TO service_role;
ALTER TABLE public.run_skill_usage ENABLE ROW LEVEL SECURITY;
CREATE POLICY "run_skill_usage admin read"
  ON public.run_skill_usage FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Seed the 20 required children_illustrated skill contracts.
INSERT INTO public.runtime_skill_contracts
  (skill_key, skill_version, enabled, supported_book_types, supported_pipeline_stages, trigger_tags, required_predecessor_skills, prompt_contract, reference_schema, qc_requirements)
VALUES
  ('children_writing_standard','1.0.0',true,ARRAY['children_illustrated'],ARRAY['generate_concept','generate_manuscript'],ARRAY['kids','writing'],'{}',jsonb_build_object('source','skills/childrens-storybook-consistency-lock'),'{}'::jsonb,jsonb_build_object('min_age_appropriateness',95)),
  ('age_appropriateness','1.0.0',true,ARRAY['children_illustrated'],ARRAY['generate_story_bible','generate_manuscript','final_release'],ARRAY['kids'],'{}',jsonb_build_object('source','skills/childrens-storybook-consistency-lock'),'{}'::jsonb,jsonb_build_object('min_score',95)),
  ('story_bible','1.0.0',true,ARRAY['children_illustrated'],ARRAY['generate_story_bible','generate_page_plan','generate_cover','generate_interior'],ARRAY['kids'],'{}',jsonb_build_object('source','skills/childrens-storybook-consistency-lock#story-bible'),jsonb_build_object('artifact','story_bible_id'),'{}'::jsonb),
  ('page_plan','1.0.0',true,ARRAY['children_illustrated'],ARRAY['generate_page_plan','generate_interior','assemble_pdf'],ARRAY['kids'],ARRAY['story_bible'],'{}'::jsonb,jsonb_build_object('artifact','page_plan_id'),'{}'::jsonb),
  ('character_bible','1.0.0',true,ARRAY['children_illustrated'],ARRAY['generate_character_bible','generate_cover','generate_interior'],ARRAY['kids'],ARRAY['story_bible'],'{}'::jsonb,jsonb_build_object('artifact','character_bible_id'),'{}'::jsonb),
  ('character_reference','1.0.0',true,ARRAY['children_illustrated'],ARRAY['generate_character_bible','generate_cover','generate_interior'],ARRAY['kids'],ARRAY['character_bible'],'{}'::jsonb,jsonb_build_object('artifact','character_reference_id'),'{}'::jsonb),
  ('illustration_style_lock','1.0.0',true,ARRAY['children_illustrated'],ARRAY['generate_cover','generate_interior'],ARRAY['kids'],'{}',jsonb_build_object('source','skills/childrens-storybook-consistency-lock#style'),jsonb_build_object('artifact','style_version'),'{}'::jsonb),
  ('character_continuity','1.0.0',true,ARRAY['children_illustrated'],ARRAY['generate_interior','final_release'],ARRAY['kids','qc'],ARRAY['character_reference'],'{}'::jsonb,'{}'::jsonb,jsonb_build_object('min_score',95)),
  ('text_image_semantic_match','1.0.0',true,ARRAY['children_illustrated'],ARRAY['generate_interior','final_release'],ARRAY['kids','qc'],ARRAY['page_plan'],'{}'::jsonb,'{}'::jsonb,jsonb_build_object('min_score',95)),
  ('image_artifact_guard','1.0.0',true,ARRAY['children_illustrated'],ARRAY['generate_cover','generate_interior'],ARRAY['kids','qc'],'{}','{}'::jsonb,'{}'::jsonb,jsonb_build_object('zero_defects',true)),
  ('cover_art_direction','1.0.0',true,ARRAY['children_illustrated'],ARRAY['generate_cover'],ARRAY['kids'],ARRAY['character_reference','illustration_style_lock'],'{}'::jsonb,'{}'::jsonb,jsonb_build_object('min_score',90)),
  ('thumbnail_mockup','1.0.0',true,ARRAY['children_illustrated'],ARRAY['generate_cover','final_release'],ARRAY['kids'],ARRAY['cover_art_direction'],'{}'::jsonb,'{}'::jsonb,jsonb_build_object('min_score',90)),
  ('pdf_integrity','1.0.0',true,ARRAY['children_illustrated'],ARRAY['assemble_pdf','final_release'],ARRAY['kids','pdf'],ARRAY['page_plan'],'{}'::jsonb,'{}'::jsonb,jsonb_build_object('zero_defects',true)),
  ('typography_layout','1.0.0',true,ARRAY['children_illustrated'],ARRAY['assemble_pdf'],ARRAY['kids','pdf'],'{}','{}'::jsonb,'{}'::jsonb,jsonb_build_object('min_score',95)),
  ('children_book_sales_page','1.0.0',true,ARRAY['children_illustrated'],ARRAY['generate_sales_page','final_release'],ARRAY['kids','storefront'],'{}','{}'::jsonb,'{}'::jsonb,jsonb_build_object('sanitization',100)),
  ('verified_product_metadata','1.0.0',true,ARRAY['children_illustrated'],ARRAY['generate_sales_page','final_release'],ARRAY['kids','storefront'],ARRAY['pdf_integrity'],'{}'::jsonb,'{}'::jsonb,jsonb_build_object('match',100)),
  ('qc_contract_auditor','1.0.0',true,ARRAY['children_illustrated'],ARRAY['final_release'],ARRAY['kids','qc'],'{}','{}'::jsonb,'{}'::jsonb,'{}'::jsonb),
  ('regression_evaluation','1.0.0',true,ARRAY['children_illustrated'],ARRAY['final_release'],ARRAY['kids','qc'],'{}','{}'::jsonb,'{}'::jsonb,'{}'::jsonb),
  ('release_guardian','1.0.0',true,ARRAY['children_illustrated'],ARRAY['final_release'],ARRAY['kids','release'],'{}','{}'::jsonb,'{}'::jsonb,'{}'::jsonb),
  ('observability_p0','1.0.0',true,ARRAY['children_illustrated'],ARRAY['final_release'],ARRAY['kids','ops'],'{}','{}'::jsonb,'{}'::jsonb,'{}'::jsonb);
