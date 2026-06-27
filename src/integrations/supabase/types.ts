export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      autopilot_runs: {
        Row: {
          cost_usd: number
          created_at: string
          duration_ms: number | null
          ebook_id: string | null
          error: string | null
          id: string
          idea_id: string | null
          payload: Json
          rewrite_count: number
          score: number | null
          status: string
          step: string
        }
        Insert: {
          cost_usd?: number
          created_at?: string
          duration_ms?: number | null
          ebook_id?: string | null
          error?: string | null
          id?: string
          idea_id?: string | null
          payload?: Json
          rewrite_count?: number
          score?: number | null
          status: string
          step: string
        }
        Update: {
          cost_usd?: number
          created_at?: string
          duration_ms?: number | null
          ebook_id?: string | null
          error?: string | null
          id?: string
          idea_id?: string | null
          payload?: Json
          rewrite_count?: number
          score?: number | null
          status?: string
          step?: string
        }
        Relationships: [
          {
            foreignKeyName: "autopilot_runs_ebook_id_fkey"
            columns: ["ebook_id"]
            isOneToOne: false
            referencedRelation: "ebooks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "autopilot_runs_idea_id_fkey"
            columns: ["idea_id"]
            isOneToOne: false
            referencedRelation: "ebook_ideas"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          cover_style_prompt: string | null
          created_at: string
          default_price: number
          description: string | null
          enabled: boolean
          id: string
          name: string
          slug: string
          updated_at: string
        }
        Insert: {
          cover_style_prompt?: string | null
          created_at?: string
          default_price?: number
          description?: string | null
          enabled?: boolean
          id?: string
          name: string
          slug: string
          updated_at?: string
        }
        Update: {
          cover_style_prompt?: string | null
          created_at?: string
          default_price?: number
          description?: string | null
          enabled?: boolean
          id?: string
          name?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      cost_log: {
        Row: {
          cost_usd: number
          created_at: string
          ebook_id: string | null
          id: string
          idea_id: string | null
          input_tokens: number
          model: string
          output_tokens: number
          step: string
        }
        Insert: {
          cost_usd?: number
          created_at?: string
          ebook_id?: string | null
          id?: string
          idea_id?: string | null
          input_tokens?: number
          model: string
          output_tokens?: number
          step: string
        }
        Update: {
          cost_usd?: number
          created_at?: string
          ebook_id?: string | null
          id?: string
          idea_id?: string | null
          input_tokens?: number
          model?: string
          output_tokens?: number
          step?: string
        }
        Relationships: [
          {
            foreignKeyName: "cost_log_ebook_id_fkey"
            columns: ["ebook_id"]
            isOneToOne: false
            referencedRelation: "ebooks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cost_log_idea_id_fkey"
            columns: ["idea_id"]
            isOneToOne: false
            referencedRelation: "ebook_ideas"
            referencedColumns: ["id"]
          },
        ]
      }
      ebook_ideas: {
        Row: {
          admin_feedback: string | null
          auto_rejected_reason: string | null
          buyer_identity: string | null
          category_id: string | null
          clarity_score: number | null
          commercial_intent_score: number | null
          compliance_risk_score: number | null
          core_pain_point: string | null
          cost_of_doing_nothing: string | null
          cost_usd: number
          created_at: string
          deeper_emotional_fear: string | null
          hard_sell_opening: string | null
          hard_sell_score: number | null
          hook: string | null
          id: string
          improvement_round: number
          notes: string | null
          objection_handling: Json | null
          outline_buyer_score: number | null
          outline_depth_score: number | null
          outline_duplicate_score: number | null
          outline_practical_score: number | null
          outline_premium_score: number | null
          outline_rewrite_count: number
          outline_structure_score: number | null
          perceived_value_boosters: Json
          premium_score: number | null
          raw_hook: string | null
          raw_subtitle: string | null
          raw_target_buyer: string | null
          raw_title: string | null
          recommended_action: string | null
          scores: Json
          shopify_meta: Json | null
          status: string
          subtitle: string | null
          target_buyer: string | null
          title: string
          topic_rewrite_count: number
          total_score: number
          transformation_promise: string | null
          updated_at: string
          value_proposition: string | null
          why_it_sells: string | null
        }
        Insert: {
          admin_feedback?: string | null
          auto_rejected_reason?: string | null
          buyer_identity?: string | null
          category_id?: string | null
          clarity_score?: number | null
          commercial_intent_score?: number | null
          compliance_risk_score?: number | null
          core_pain_point?: string | null
          cost_of_doing_nothing?: string | null
          cost_usd?: number
          created_at?: string
          deeper_emotional_fear?: string | null
          hard_sell_opening?: string | null
          hard_sell_score?: number | null
          hook?: string | null
          id?: string
          improvement_round?: number
          notes?: string | null
          objection_handling?: Json | null
          outline_buyer_score?: number | null
          outline_depth_score?: number | null
          outline_duplicate_score?: number | null
          outline_practical_score?: number | null
          outline_premium_score?: number | null
          outline_rewrite_count?: number
          outline_structure_score?: number | null
          perceived_value_boosters?: Json
          premium_score?: number | null
          raw_hook?: string | null
          raw_subtitle?: string | null
          raw_target_buyer?: string | null
          raw_title?: string | null
          recommended_action?: string | null
          scores?: Json
          shopify_meta?: Json | null
          status?: string
          subtitle?: string | null
          target_buyer?: string | null
          title: string
          topic_rewrite_count?: number
          total_score?: number
          transformation_promise?: string | null
          updated_at?: string
          value_proposition?: string | null
          why_it_sells?: string | null
        }
        Update: {
          admin_feedback?: string | null
          auto_rejected_reason?: string | null
          buyer_identity?: string | null
          category_id?: string | null
          clarity_score?: number | null
          commercial_intent_score?: number | null
          compliance_risk_score?: number | null
          core_pain_point?: string | null
          cost_of_doing_nothing?: string | null
          cost_usd?: number
          created_at?: string
          deeper_emotional_fear?: string | null
          hard_sell_opening?: string | null
          hard_sell_score?: number | null
          hook?: string | null
          id?: string
          improvement_round?: number
          notes?: string | null
          objection_handling?: Json | null
          outline_buyer_score?: number | null
          outline_depth_score?: number | null
          outline_duplicate_score?: number | null
          outline_practical_score?: number | null
          outline_premium_score?: number | null
          outline_rewrite_count?: number
          outline_structure_score?: number | null
          perceived_value_boosters?: Json
          premium_score?: number | null
          raw_hook?: string | null
          raw_subtitle?: string | null
          raw_target_buyer?: string | null
          raw_title?: string | null
          recommended_action?: string | null
          scores?: Json
          shopify_meta?: Json | null
          status?: string
          subtitle?: string | null
          target_buyer?: string | null
          title?: string
          topic_rewrite_count?: number
          total_score?: number
          transformation_promise?: string | null
          updated_at?: string
          value_proposition?: string | null
          why_it_sells?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ebook_ideas_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      ebooks: {
        Row: {
          auto_approved: boolean
          auto_publish: boolean
          autopilot_mode: string
          autopilot_state: string
          bonuses: Json
          category_id: string | null
          chapter_qc: Json
          chapters: Json
          compliance_safety_score: number | null
          conversion_score: number | null
          cost_usd: number
          cover_approved: boolean
          cover_bg_url: string | null
          cover_image_url: string | null
          cover_prompt: string | null
          cover_qc: Json | null
          cover_score: number | null
          cover_spec: Json | null
          cover_url: string | null
          created_at: string
          editorial_qc: Json
          final_approved: boolean
          final_approved_at: string | null
          final_approved_by: string | null
          final_quality_score: number | null
          hook: string | null
          id: string
          idea_id: string | null
          interior_visuals: Json | null
          needs_review_reason: string | null
          pdf_qc: Json | null
          pdf_url: string | null
          price: number
          product_copy: Json
          product_description: string | null
          product_page_qc: Json
          product_type: string
          qc: Json
          seo_meta: string | null
          seo_title: string | null
          shopify_events: Json
          shopify_handle: string | null
          shopify_last_error: string | null
          shopify_last_event_at: string | null
          shopify_product_id: string | null
          shopify_status: string
          status: string
          subtitle: string | null
          tags: string[]
          target_buyer: string | null
          title: string
          toc: Json
          updated_at: string
          vendor: string
          word_count: number
        }
        Insert: {
          auto_approved?: boolean
          auto_publish?: boolean
          autopilot_mode?: string
          autopilot_state?: string
          bonuses?: Json
          category_id?: string | null
          chapter_qc?: Json
          chapters?: Json
          compliance_safety_score?: number | null
          conversion_score?: number | null
          cost_usd?: number
          cover_approved?: boolean
          cover_bg_url?: string | null
          cover_image_url?: string | null
          cover_prompt?: string | null
          cover_qc?: Json | null
          cover_score?: number | null
          cover_spec?: Json | null
          cover_url?: string | null
          created_at?: string
          editorial_qc?: Json
          final_approved?: boolean
          final_approved_at?: string | null
          final_approved_by?: string | null
          final_quality_score?: number | null
          hook?: string | null
          id?: string
          idea_id?: string | null
          interior_visuals?: Json | null
          needs_review_reason?: string | null
          pdf_qc?: Json | null
          pdf_url?: string | null
          price?: number
          product_copy?: Json
          product_description?: string | null
          product_page_qc?: Json
          product_type?: string
          qc?: Json
          seo_meta?: string | null
          seo_title?: string | null
          shopify_events?: Json
          shopify_handle?: string | null
          shopify_last_error?: string | null
          shopify_last_event_at?: string | null
          shopify_product_id?: string | null
          shopify_status?: string
          status?: string
          subtitle?: string | null
          tags?: string[]
          target_buyer?: string | null
          title: string
          toc?: Json
          updated_at?: string
          vendor?: string
          word_count?: number
        }
        Update: {
          auto_approved?: boolean
          auto_publish?: boolean
          autopilot_mode?: string
          autopilot_state?: string
          bonuses?: Json
          category_id?: string | null
          chapter_qc?: Json
          chapters?: Json
          compliance_safety_score?: number | null
          conversion_score?: number | null
          cost_usd?: number
          cover_approved?: boolean
          cover_bg_url?: string | null
          cover_image_url?: string | null
          cover_prompt?: string | null
          cover_qc?: Json | null
          cover_score?: number | null
          cover_spec?: Json | null
          cover_url?: string | null
          created_at?: string
          editorial_qc?: Json
          final_approved?: boolean
          final_approved_at?: string | null
          final_approved_by?: string | null
          final_quality_score?: number | null
          hook?: string | null
          id?: string
          idea_id?: string | null
          interior_visuals?: Json | null
          needs_review_reason?: string | null
          pdf_qc?: Json | null
          pdf_url?: string | null
          price?: number
          product_copy?: Json
          product_description?: string | null
          product_page_qc?: Json
          product_type?: string
          qc?: Json
          seo_meta?: string | null
          seo_title?: string | null
          shopify_events?: Json
          shopify_handle?: string | null
          shopify_last_error?: string | null
          shopify_last_event_at?: string | null
          shopify_product_id?: string | null
          shopify_status?: string
          status?: string
          subtitle?: string | null
          tags?: string[]
          target_buyer?: string | null
          title?: string
          toc?: Json
          updated_at?: string
          vendor?: string
          word_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "ebooks_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ebooks_idea_id_fkey"
            columns: ["idea_id"]
            isOneToOne: false
            referencedRelation: "ebook_ideas"
            referencedColumns: ["id"]
          },
        ]
      }
      generation_jobs: {
        Row: {
          attempts: number
          created_at: string
          ebook_id: string | null
          error: string | null
          finished_at: string | null
          id: string
          idea_id: string | null
          payload: Json
          scheduled_for: string
          started_at: string | null
          status: Database["public"]["Enums"]["job_status"]
          type: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          ebook_id?: string | null
          error?: string | null
          finished_at?: string | null
          id?: string
          idea_id?: string | null
          payload?: Json
          scheduled_for?: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          type: string
        }
        Update: {
          attempts?: number
          created_at?: string
          ebook_id?: string | null
          error?: string | null
          finished_at?: string | null
          id?: string
          idea_id?: string | null
          payload?: Json
          scheduled_for?: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "generation_jobs_ebook_id_fkey"
            columns: ["ebook_id"]
            isOneToOne: false
            referencedRelation: "ebooks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generation_jobs_idea_id_fkey"
            columns: ["idea_id"]
            isOneToOne: false
            referencedRelation: "ebook_ideas"
            referencedColumns: ["id"]
          },
        ]
      }
      generation_settings: {
        Row: {
          auto_publish: boolean
          autopilot_enabled: boolean
          autopilot_mode: string
          cron_enabled: boolean
          daily_budget_usd: number
          daily_quota: number
          enabled_category_ids: string[]
          id: number
          max_refund_risk: number
          min_score_threshold: number
          min_word_count: number
          mode: Database["public"]["Enums"]["generation_mode"]
          publish_hour_utc: number
          updated_at: string
        }
        Insert: {
          auto_publish?: boolean
          autopilot_enabled?: boolean
          autopilot_mode?: string
          cron_enabled?: boolean
          daily_budget_usd?: number
          daily_quota?: number
          enabled_category_ids?: string[]
          id?: number
          max_refund_risk?: number
          min_score_threshold?: number
          min_word_count?: number
          mode?: Database["public"]["Enums"]["generation_mode"]
          publish_hour_utc?: number
          updated_at?: string
        }
        Update: {
          auto_publish?: boolean
          autopilot_enabled?: boolean
          autopilot_mode?: string
          cron_enabled?: boolean
          daily_budget_usd?: number
          daily_quota?: number
          enabled_category_ids?: string[]
          id?: number
          max_refund_risk?: number
          min_score_threshold?: number
          min_word_count?: number
          mode?: Database["public"]["Enums"]["generation_mode"]
          publish_hour_utc?: number
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      app_role: "admin"
      generation_mode: "low_cost" | "premium" | "hybrid"
      job_status: "queued" | "running" | "done" | "failed"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin"],
      generation_mode: ["low_cost", "premium", "hybrid"],
      job_status: ["queued", "running", "done", "failed"],
    },
  },
} as const
