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
      api_costs: {
        Row: {
          cost_usd: number
          created_at: string
          ebook_id: string | null
          id: string
          idea_id: string | null
          input_tokens: number | null
          metadata: Json
          model: string | null
          operation: string | null
          output_tokens: number | null
          provider: string
          request_response: Json
          stage: Database["public"]["Enums"]["pipeline_status"] | null
          updated_at: string
        }
        Insert: {
          cost_usd?: number
          created_at?: string
          ebook_id?: string | null
          id?: string
          idea_id?: string | null
          input_tokens?: number | null
          metadata?: Json
          model?: string | null
          operation?: string | null
          output_tokens?: number | null
          provider: string
          request_response?: Json
          stage?: Database["public"]["Enums"]["pipeline_status"] | null
          updated_at?: string
        }
        Update: {
          cost_usd?: number
          created_at?: string
          ebook_id?: string | null
          id?: string
          idea_id?: string | null
          input_tokens?: number | null
          metadata?: Json
          model?: string | null
          operation?: string | null
          output_tokens?: number | null
          provider?: string
          request_response?: Json
          stage?: Database["public"]["Enums"]["pipeline_status"] | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_costs_ebook_id_fkey"
            columns: ["ebook_id"]
            isOneToOne: false
            referencedRelation: "ebooks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "api_costs_idea_id_fkey"
            columns: ["idea_id"]
            isOneToOne: false
            referencedRelation: "ebook_ideas"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_schedules: {
        Row: {
          config: Json
          created_at: string
          cron_expression: string | null
          description: string | null
          enabled: boolean
          id: string
          last_run_at: string | null
          metadata: Json
          name: string
          next_run_at: string | null
          scheduled_at: string | null
          updated_at: string
        }
        Insert: {
          config?: Json
          created_at?: string
          cron_expression?: string | null
          description?: string | null
          enabled?: boolean
          id?: string
          last_run_at?: string | null
          metadata?: Json
          name: string
          next_run_at?: string | null
          scheduled_at?: string | null
          updated_at?: string
        }
        Update: {
          config?: Json
          created_at?: string
          cron_expression?: string | null
          description?: string | null
          enabled?: boolean
          id?: string
          last_run_at?: string | null
          metadata?: Json
          name?: string
          next_run_at?: string | null
          scheduled_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      autopilot_kids_runs: {
        Row: {
          archived_at: string | null
          attempts: number
          blocker_reason: string | null
          completed_at: string | null
          cost_usd: number | null
          created_at: string
          current_step: string | null
          current_step_label: string | null
          ebook_kids_id: string | null
          error_details: Json | null
          human_review_reason: string | null
          id: string
          metadata: Json
          pipeline_stage: string | null
          progress_percent: number | null
          sellable: boolean
          started_at: string
          status: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          attempts?: number
          blocker_reason?: string | null
          completed_at?: string | null
          cost_usd?: number | null
          created_at?: string
          current_step?: string | null
          current_step_label?: string | null
          ebook_kids_id?: string | null
          error_details?: Json | null
          human_review_reason?: string | null
          id?: string
          metadata?: Json
          pipeline_stage?: string | null
          progress_percent?: number | null
          sellable?: boolean
          started_at?: string
          status?: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          attempts?: number
          blocker_reason?: string | null
          completed_at?: string | null
          cost_usd?: number | null
          created_at?: string
          current_step?: string | null
          current_step_label?: string | null
          ebook_kids_id?: string | null
          error_details?: Json | null
          human_review_reason?: string | null
          id?: string
          metadata?: Json
          pipeline_stage?: string | null
          progress_percent?: number | null
          sellable?: boolean
          started_at?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "autopilot_kids_runs_ebook_kids_id_fkey"
            columns: ["ebook_kids_id"]
            isOneToOne: false
            referencedRelation: "ebooks_kids"
            referencedColumns: ["id"]
          },
        ]
      }
      autopilot_kids_steps: {
        Row: {
          attempts: number
          completed_at: string | null
          cost_usd: number | null
          created_at: string
          duration_ms: number | null
          error_message: string | null
          id: string
          output: Json | null
          run_id: string
          started_at: string | null
          status: string
          step_label: string | null
          step_name: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          completed_at?: string | null
          cost_usd?: number | null
          created_at?: string
          duration_ms?: number | null
          error_message?: string | null
          id?: string
          output?: Json | null
          run_id: string
          started_at?: string | null
          status?: string
          step_label?: string | null
          step_name: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          completed_at?: string | null
          cost_usd?: number | null
          created_at?: string
          duration_ms?: number | null
          error_message?: string | null
          id?: string
          output?: Json | null
          run_id?: string
          started_at?: string | null
          status?: string
          step_label?: string | null
          step_name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "autopilot_kids_steps_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "autopilot_kids_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      autopilot_pipeline_runs: {
        Row: {
          admin_needed_reason: string | null
          blocker_class: string | null
          blocker_reason: string | null
          completed_at: string | null
          current_action_message: string | null
          current_step: string | null
          current_step_label: string | null
          current_subtask: string | null
          ebook_id: string | null
          error_message: string | null
          failed_at: string | null
          final_report_json: Json
          id: string
          idea_id: string | null
          last_heartbeat_at: string | null
          mode: string | null
          next_retry_at: string | null
          pause_requested: boolean
          preflight_json: Json
          progress_percent: number
          queue_position: number | null
          resume_from_step: string | null
          started_at: string
          status: string
          summary_json: Json
          test_mode: boolean
          triggered_by: string | null
          updated_at: string
        }
        Insert: {
          admin_needed_reason?: string | null
          blocker_class?: string | null
          blocker_reason?: string | null
          completed_at?: string | null
          current_action_message?: string | null
          current_step?: string | null
          current_step_label?: string | null
          current_subtask?: string | null
          ebook_id?: string | null
          error_message?: string | null
          failed_at?: string | null
          final_report_json?: Json
          id?: string
          idea_id?: string | null
          last_heartbeat_at?: string | null
          mode?: string | null
          next_retry_at?: string | null
          pause_requested?: boolean
          preflight_json?: Json
          progress_percent?: number
          queue_position?: number | null
          resume_from_step?: string | null
          started_at?: string
          status?: string
          summary_json?: Json
          test_mode?: boolean
          triggered_by?: string | null
          updated_at?: string
        }
        Update: {
          admin_needed_reason?: string | null
          blocker_class?: string | null
          blocker_reason?: string | null
          completed_at?: string | null
          current_action_message?: string | null
          current_step?: string | null
          current_step_label?: string | null
          current_subtask?: string | null
          ebook_id?: string | null
          error_message?: string | null
          failed_at?: string | null
          final_report_json?: Json
          id?: string
          idea_id?: string | null
          last_heartbeat_at?: string | null
          mode?: string | null
          next_retry_at?: string | null
          pause_requested?: boolean
          preflight_json?: Json
          progress_percent?: number
          queue_position?: number | null
          resume_from_step?: string | null
          started_at?: string
          status?: string
          summary_json?: Json
          test_mode?: boolean
          triggered_by?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      autopilot_pipeline_steps: {
        Row: {
          auto_fix_attempts: number
          completed_at: string | null
          created_at: string
          duration_ms: number | null
          ebook_id: string | null
          error_json: Json
          error_message: string | null
          id: string
          max_auto_fix_attempts: number
          message: string | null
          metadata_json: Json
          next_step: string | null
          output_json: Json
          output_valid: boolean
          qc_score: number | null
          repair_action: string | null
          required_score: number | null
          run_id: string
          score: number | null
          started_at: string | null
          status: string
          step_label: string
          step_name: string
          step_order: number
        }
        Insert: {
          auto_fix_attempts?: number
          completed_at?: string | null
          created_at?: string
          duration_ms?: number | null
          ebook_id?: string | null
          error_json?: Json
          error_message?: string | null
          id?: string
          max_auto_fix_attempts?: number
          message?: string | null
          metadata_json?: Json
          next_step?: string | null
          output_json?: Json
          output_valid?: boolean
          qc_score?: number | null
          repair_action?: string | null
          required_score?: number | null
          run_id: string
          score?: number | null
          started_at?: string | null
          status?: string
          step_label: string
          step_name: string
          step_order: number
        }
        Update: {
          auto_fix_attempts?: number
          completed_at?: string | null
          created_at?: string
          duration_ms?: number | null
          ebook_id?: string | null
          error_json?: Json
          error_message?: string | null
          id?: string
          max_auto_fix_attempts?: number
          message?: string | null
          metadata_json?: Json
          next_step?: string | null
          output_json?: Json
          output_valid?: boolean
          qc_score?: number | null
          repair_action?: string | null
          required_score?: number | null
          run_id?: string
          score?: number | null
          started_at?: string | null
          status?: string
          step_label?: string
          step_name?: string
          step_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "autopilot_pipeline_steps_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "autopilot_pipeline_runs"
            referencedColumns: ["id"]
          },
        ]
      }
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
      book_royalty_markets: {
        Row: {
          book_id: string
          book_sale_price_usd: number
          created_at: string
          current_indicative_book_value_usd: number
          current_indicative_unit_price_usd: number
          gateway_fee_rate: number
          id: string
          initial_book_value_usd: number
          initial_unit_price_usd: number
          max_daily_value_change: number
          minimum_purchase_usd: number
          royalty_pool_percent: number
          sales_gateway_fee_rate: number
          sales_vat_rate: number
          status: Database["public"]["Enums"]["royalty_market_status"]
          thai_vat_rate: number
          total_units: number
          units_available: number
          updated_at: string
          valuation_multiple: number
        }
        Insert: {
          book_id: string
          book_sale_price_usd?: number
          created_at?: string
          current_indicative_book_value_usd?: number
          current_indicative_unit_price_usd?: number
          gateway_fee_rate?: number
          id?: string
          initial_book_value_usd?: number
          initial_unit_price_usd?: number
          max_daily_value_change?: number
          minimum_purchase_usd?: number
          royalty_pool_percent?: number
          sales_gateway_fee_rate?: number
          sales_vat_rate?: number
          status?: Database["public"]["Enums"]["royalty_market_status"]
          thai_vat_rate?: number
          total_units?: number
          units_available?: number
          updated_at?: string
          valuation_multiple?: number
        }
        Update: {
          book_id?: string
          book_sale_price_usd?: number
          created_at?: string
          current_indicative_book_value_usd?: number
          current_indicative_unit_price_usd?: number
          gateway_fee_rate?: number
          id?: string
          initial_book_value_usd?: number
          initial_unit_price_usd?: number
          max_daily_value_change?: number
          minimum_purchase_usd?: number
          royalty_pool_percent?: number
          sales_gateway_fee_rate?: number
          sales_vat_rate?: number
          status?: Database["public"]["Enums"]["royalty_market_status"]
          thai_vat_rate?: number
          total_units?: number
          units_available?: number
          updated_at?: string
          valuation_multiple?: number
        }
        Relationships: []
      }
      book_sales_ledger: {
        Row: {
          book_id: string
          chargeback_usd: number
          created_at: string
          gateway_fee_usd: number
          id: string
          net_revenue_usd: number
          order_id: string | null
          refund_usd: number
          royalty_pool_usd: number
          sale_price_usd: number
          sale_status: Database["public"]["Enums"]["royalty_sale_status"]
          sold_at: string
          vat_usd: number
        }
        Insert: {
          book_id: string
          chargeback_usd?: number
          created_at?: string
          gateway_fee_usd?: number
          id?: string
          net_revenue_usd: number
          order_id?: string | null
          refund_usd?: number
          royalty_pool_usd: number
          sale_price_usd: number
          sale_status?: Database["public"]["Enums"]["royalty_sale_status"]
          sold_at?: string
          vat_usd?: number
        }
        Update: {
          book_id?: string
          chargeback_usd?: number
          created_at?: string
          gateway_fee_usd?: number
          id?: string
          net_revenue_usd?: number
          order_id?: string | null
          refund_usd?: number
          royalty_pool_usd?: number
          sale_price_usd?: number
          sale_status?: Database["public"]["Enums"]["royalty_sale_status"]
          sold_at?: string
          vat_usd?: number
        }
        Relationships: []
      }
      book_series: {
        Row: {
          cover_image_url: string | null
          created_at: string
          description: string | null
          id: string
          slug: string
          sort_order: number
          title: string
          updated_at: string
        }
        Insert: {
          cover_image_url?: string | null
          created_at?: string
          description?: string | null
          id?: string
          slug: string
          sort_order?: number
          title: string
          updated_at?: string
        }
        Update: {
          cover_image_url?: string | null
          created_at?: string
          description?: string | null
          id?: string
          slug?: string
          sort_order?: number
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      book_valuation_snapshots: {
        Row: {
          book_id: string
          calculation_json: Json
          created_at: string
          growth_adjustment: number
          id: string
          indicative_book_value: number
          indicative_unit_value: number
          initial_value: number
          quality_adjustment: number
          refund_adjustment: number
          snapshot_date: string
          trailing_30d_net_sales: number
          trailing_7d_net_sales: number
          trailing_90d_net_sales: number
          valuation_multiple: number
        }
        Insert: {
          book_id: string
          calculation_json?: Json
          created_at?: string
          growth_adjustment?: number
          id?: string
          indicative_book_value: number
          indicative_unit_value: number
          initial_value: number
          quality_adjustment?: number
          refund_adjustment?: number
          snapshot_date?: string
          trailing_30d_net_sales?: number
          trailing_7d_net_sales?: number
          trailing_90d_net_sales?: number
          valuation_multiple: number
        }
        Update: {
          book_id?: string
          calculation_json?: Json
          created_at?: string
          growth_adjustment?: number
          id?: string
          indicative_book_value?: number
          indicative_unit_value?: number
          initial_value?: number
          quality_adjustment?: number
          refund_adjustment?: number
          snapshot_date?: string
          trailing_30d_net_sales?: number
          trailing_7d_net_sales?: number
          trailing_90d_net_sales?: number
          valuation_multiple?: number
        }
        Relationships: []
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
      coloring_categories: {
        Row: {
          allowed_subjects: string[]
          allowed_supporting_elements: string[]
          background_complexity: string
          category_description: string
          category_key: string
          category_name: string
          coloring_page_count: number
          complexity_level: string
          created_at: string
          forbidden_subjects: string[]
          id: string
          line_art_style: string
          target_age_max: number
          target_age_min: number
          trim_size: string
          updated_at: string
        }
        Insert: {
          allowed_subjects?: string[]
          allowed_supporting_elements?: string[]
          background_complexity: string
          category_description: string
          category_key: string
          category_name: string
          coloring_page_count?: number
          complexity_level: string
          created_at?: string
          forbidden_subjects?: string[]
          id?: string
          line_art_style: string
          target_age_max: number
          target_age_min: number
          trim_size?: string
          updated_at?: string
        }
        Update: {
          allowed_subjects?: string[]
          allowed_supporting_elements?: string[]
          background_complexity?: string
          category_description?: string
          category_key?: string
          category_name?: string
          coloring_page_count?: number
          complexity_level?: string
          created_at?: string
          forbidden_subjects?: string[]
          id?: string
          line_art_style?: string
          target_age_max?: number
          target_age_min?: number
          trim_size?: string
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
          provider: string | null
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
          provider?: string | null
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
          provider?: string | null
          step?: string
        }
        Relationships: [
          {
            foreignKeyName: "cost_log_idea_id_fkey"
            columns: ["idea_id"]
            isOneToOne: false
            referencedRelation: "ebook_ideas"
            referencedColumns: ["id"]
          },
        ]
      }
      cover_style_reference: {
        Row: {
          created_at: string
          id: string
          image_url: string
          is_active: boolean
          layout_notes: string | null
          lighting: string | null
          name: string
          palette: Json
          storage_path: string | null
          style_summary: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          image_url: string
          is_active?: boolean
          layout_notes?: string | null
          lighting?: string | null
          name: string
          palette?: Json
          storage_path?: string | null
          style_summary?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          image_url?: string
          is_active?: boolean
          layout_notes?: string | null
          lighting?: string | null
          name?: string
          palette?: Json
          storage_path?: string | null
          style_summary?: string | null
        }
        Relationships: []
      }
      creator_submissions: {
        Row: {
          admin_notes: string | null
          age_band: string
          created_at: string
          email: string
          id: string
          name: string
          status: string
          story_idea: string
          theme_slug: string | null
          updated_at: string
        }
        Insert: {
          admin_notes?: string | null
          age_band?: string
          created_at?: string
          email: string
          id?: string
          name: string
          status?: string
          story_idea: string
          theme_slug?: string | null
          updated_at?: string
        }
        Update: {
          admin_notes?: string | null
          age_band?: string
          created_at?: string
          email?: string
          id?: string
          name?: string
          status?: string
          story_idea?: string
          theme_slug?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      download_grants: {
        Row: {
          buyer_email: string
          buyer_user_id: string | null
          created_at: string
          download_count: number
          ebook_id: string
          expires_at: string
          id: string
          last_downloaded_at: string | null
          max_downloads: number
          order_id: string
          token: string
        }
        Insert: {
          buyer_email: string
          buyer_user_id?: string | null
          created_at?: string
          download_count?: number
          ebook_id: string
          expires_at?: string
          id?: string
          last_downloaded_at?: string | null
          max_downloads?: number
          order_id: string
          token?: string
        }
        Update: {
          buyer_email?: string
          buyer_user_id?: string | null
          created_at?: string
          download_count?: number
          ebook_id?: string
          expires_at?: string
          id?: string
          last_downloaded_at?: string | null
          max_downloads?: number
          order_id?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "download_grants_ebook_id_fkey"
            columns: ["ebook_id"]
            isOneToOne: false
            referencedRelation: "ebooks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "download_grants_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      ebook_assets: {
        Row: {
          byte_size: number | null
          created_at: string
          ebook_id: string
          id: string
          kind: string
          metadata: Json
          mime_type: string | null
          storage_path: string | null
          updated_at: string
          url: string | null
          visual_plan: Json
        }
        Insert: {
          byte_size?: number | null
          created_at?: string
          ebook_id: string
          id?: string
          kind: string
          metadata?: Json
          mime_type?: string | null
          storage_path?: string | null
          updated_at?: string
          url?: string | null
          visual_plan?: Json
        }
        Update: {
          byte_size?: number | null
          created_at?: string
          ebook_id?: string
          id?: string
          kind?: string
          metadata?: Json
          mime_type?: string | null
          storage_path?: string | null
          updated_at?: string
          url?: string | null
          visual_plan?: Json
        }
        Relationships: [
          {
            foreignKeyName: "ebook_assets_ebook_id_fkey"
            columns: ["ebook_id"]
            isOneToOne: false
            referencedRelation: "ebooks"
            referencedColumns: ["id"]
          },
        ]
      }
      ebook_chapters: {
        Row: {
          brief: string | null
          chapter_index: number
          content: string | null
          created_at: string
          ebook_id: string
          id: string
          metadata: Json
          pipeline_status: Database["public"]["Enums"]["pipeline_status"]
          qc_scores: Json
          qc_status: string | null
          rejection_reason: string | null
          rewrite_count: number
          title: string
          updated_at: string
          word_count: number | null
        }
        Insert: {
          brief?: string | null
          chapter_index: number
          content?: string | null
          created_at?: string
          ebook_id: string
          id?: string
          metadata?: Json
          pipeline_status?: Database["public"]["Enums"]["pipeline_status"]
          qc_scores?: Json
          qc_status?: string | null
          rejection_reason?: string | null
          rewrite_count?: number
          title: string
          updated_at?: string
          word_count?: number | null
        }
        Update: {
          brief?: string | null
          chapter_index?: number
          content?: string | null
          created_at?: string
          ebook_id?: string
          id?: string
          metadata?: Json
          pipeline_status?: Database["public"]["Enums"]["pipeline_status"]
          qc_scores?: Json
          qc_status?: string | null
          rejection_reason?: string | null
          rewrite_count?: number
          title?: string
          updated_at?: string
          word_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ebook_chapters_ebook_id_fkey"
            columns: ["ebook_id"]
            isOneToOne: false
            referencedRelation: "ebooks"
            referencedColumns: ["id"]
          },
        ]
      }
      ebook_ideas: {
        Row: {
          admin_feedback: string | null
          auto_rejected_reason: string | null
          buyer_appeal_score: number | null
          buyer_identity: string | null
          category_id: string | null
          clarity_score: number | null
          commercial_intent_score: number | null
          compliance_notes: string | null
          compliance_risk_score: number | null
          core_pain_point: string | null
          cost_of_doing_nothing: string | null
          cost_usd: number
          created_at: string
          deeper_emotional_fear: string | null
          generation_mode: string
          hard_sell_opening: string | null
          hard_sell_score: number | null
          hard_sell_strength_score: number | null
          hook: string | null
          id: string
          idea_score: number | null
          improvement_round: number
          market_intelligence_id: string | null
          metadata: Json
          notes: string | null
          objection_handling: Json | null
          outline: Json
          outline_buyer_score: number | null
          outline_depth_score: number | null
          outline_duplicate_score: number | null
          outline_practical_score: number | null
          outline_premium_score: number | null
          outline_rewrite_count: number
          outline_structure_score: number | null
          parent_idea_id: string | null
          perceived_value_boosters: Json
          pipeline_status: Database["public"]["Enums"]["pipeline_status"]
          premium_score: number | null
          raw_ai: Json
          raw_hook: string | null
          raw_subtitle: string | null
          raw_target_buyer: string | null
          raw_title: string | null
          recommended_action: string | null
          rejected_reason: string | null
          research_payload: Json
          scores: Json
          selected: boolean
          status: string
          storefront_meta: Json | null
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
          buyer_appeal_score?: number | null
          buyer_identity?: string | null
          category_id?: string | null
          clarity_score?: number | null
          commercial_intent_score?: number | null
          compliance_notes?: string | null
          compliance_risk_score?: number | null
          core_pain_point?: string | null
          cost_of_doing_nothing?: string | null
          cost_usd?: number
          created_at?: string
          deeper_emotional_fear?: string | null
          generation_mode?: string
          hard_sell_opening?: string | null
          hard_sell_score?: number | null
          hard_sell_strength_score?: number | null
          hook?: string | null
          id?: string
          idea_score?: number | null
          improvement_round?: number
          market_intelligence_id?: string | null
          metadata?: Json
          notes?: string | null
          objection_handling?: Json | null
          outline?: Json
          outline_buyer_score?: number | null
          outline_depth_score?: number | null
          outline_duplicate_score?: number | null
          outline_practical_score?: number | null
          outline_premium_score?: number | null
          outline_rewrite_count?: number
          outline_structure_score?: number | null
          parent_idea_id?: string | null
          perceived_value_boosters?: Json
          pipeline_status?: Database["public"]["Enums"]["pipeline_status"]
          premium_score?: number | null
          raw_ai?: Json
          raw_hook?: string | null
          raw_subtitle?: string | null
          raw_target_buyer?: string | null
          raw_title?: string | null
          recommended_action?: string | null
          rejected_reason?: string | null
          research_payload?: Json
          scores?: Json
          selected?: boolean
          status?: string
          storefront_meta?: Json | null
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
          buyer_appeal_score?: number | null
          buyer_identity?: string | null
          category_id?: string | null
          clarity_score?: number | null
          commercial_intent_score?: number | null
          compliance_notes?: string | null
          compliance_risk_score?: number | null
          core_pain_point?: string | null
          cost_of_doing_nothing?: string | null
          cost_usd?: number
          created_at?: string
          deeper_emotional_fear?: string | null
          generation_mode?: string
          hard_sell_opening?: string | null
          hard_sell_score?: number | null
          hard_sell_strength_score?: number | null
          hook?: string | null
          id?: string
          idea_score?: number | null
          improvement_round?: number
          market_intelligence_id?: string | null
          metadata?: Json
          notes?: string | null
          objection_handling?: Json | null
          outline?: Json
          outline_buyer_score?: number | null
          outline_depth_score?: number | null
          outline_duplicate_score?: number | null
          outline_practical_score?: number | null
          outline_premium_score?: number | null
          outline_rewrite_count?: number
          outline_structure_score?: number | null
          parent_idea_id?: string | null
          perceived_value_boosters?: Json
          pipeline_status?: Database["public"]["Enums"]["pipeline_status"]
          premium_score?: number | null
          raw_ai?: Json
          raw_hook?: string | null
          raw_subtitle?: string | null
          raw_target_buyer?: string | null
          raw_title?: string | null
          recommended_action?: string | null
          rejected_reason?: string | null
          research_payload?: Json
          scores?: Json
          selected?: boolean
          status?: string
          storefront_meta?: Json | null
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
          {
            foreignKeyName: "ebook_ideas_market_intelligence_id_fkey"
            columns: ["market_intelligence_id"]
            isOneToOne: false
            referencedRelation: "market_intelligence"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ebook_ideas_parent_idea_id_fkey"
            columns: ["parent_idea_id"]
            isOneToOne: false
            referencedRelation: "ebook_ideas"
            referencedColumns: ["id"]
          },
        ]
      }
      ebook_kids_ages: {
        Row: {
          age_group_id: string
          created_at: string
          ebook_id: string
        }
        Insert: {
          age_group_id: string
          created_at?: string
          ebook_id: string
        }
        Update: {
          age_group_id?: string
          created_at?: string
          ebook_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ebook_kids_ages_age_group_id_fkey"
            columns: ["age_group_id"]
            isOneToOne: false
            referencedRelation: "kids_age_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ebook_kids_ages_ebook_id_fkey"
            columns: ["ebook_id"]
            isOneToOne: false
            referencedRelation: "ebooks"
            referencedColumns: ["id"]
          },
        ]
      }
      ebook_kids_themes: {
        Row: {
          created_at: string
          ebook_id: string
          theme_id: string
        }
        Insert: {
          created_at?: string
          ebook_id: string
          theme_id: string
        }
        Update: {
          created_at?: string
          ebook_id?: string
          theme_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ebook_kids_themes_ebook_id_fkey"
            columns: ["ebook_id"]
            isOneToOne: false
            referencedRelation: "ebooks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ebook_kids_themes_theme_id_fkey"
            columns: ["theme_id"]
            isOneToOne: false
            referencedRelation: "kids_themes"
            referencedColumns: ["id"]
          },
        ]
      }
      ebooks: {
        Row: {
          action_plan_json: Json | null
          admin_review_reason: string | null
          auto_approved: boolean
          auto_fix_attempt_count: number
          auto_fix_attempts: number
          auto_fix_history: Json
          auto_publish: boolean
          autofix_attempt: number | null
          autofix_max: number | null
          autopilot_mode: string
          autopilot_state: string
          benefit_bullets: Json | null
          blocked_at: string | null
          blocker_class: string | null
          blocker_reason: string | null
          body_html: string | null
          bonus_section_json: Json | null
          bonuses: Json
          browserless_retry_count: number
          bundle_price_recommendation: number | null
          buyer_appeal_score: number | null
          canonical_status: string | null
          category_id: string | null
          category_slug: string | null
          chapter_qc: Json
          chapters: Json
          cliffhanger_hook: string | null
          compare_at_price: number | null
          compliance_rewrites_json: Json | null
          compliance_safety_score: number | null
          content_depth_score: number | null
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
          current_action_message: string | null
          current_qc_score: number | null
          current_step: string | null
          current_step_label: string | null
          current_subtask: string | null
          editorial_polish_score: number | null
          editorial_qc: Json
          estimated_start_after_run_id: string | null
          failed_component: string | null
          failed_gate: string | null
          failed_score: number | null
          final_approved: boolean
          final_approved_at: string | null
          final_approved_by: string | null
          final_manuscript_qc: Json
          final_manuscript_score: number | null
          final_quality_score: number | null
          hard_sell_strength_score: number | null
          high_price_test: number | null
          hook: string | null
          hook_description: string | null
          id: string
          idea_id: string | null
          inside_illustration_plan_json: Json | null
          inside_illustration_relevance_score: number | null
          inside_illustrations_json: Json | null
          interior_visuals: Json | null
          is_bestseller: boolean
          key_benefits: Json | null
          kids_scene_briefs_json: Json | null
          kids_visual_bible: Json | null
          last_auto_fix_action: string | null
          last_heartbeat_at: string | null
          launch_price: number | null
          listed_at: string | null
          listing_status: string
          long_description: string | null
          low_price_test: number | null
          manuscript_fix_count: number
          manuscript_qc_status: string | null
          max_auto_fix_attempts: number
          memory_state: Json
          meta_description: string | null
          metadata: Json
          needs_review_reason: string | null
          next_recommended_action: string | null
          next_retry_at: string | null
          outline: Json
          outline_json: Json
          outline_qc: Json
          outline_rewrite_count: number
          pdf_approved: boolean
          pdf_diagram_score: number | null
          pdf_generated_at: string | null
          pdf_html_url: string | null
          pdf_layout_score: number | null
          pdf_page_count: number | null
          pdf_qc: Json | null
          pdf_readability_score: number | null
          pdf_render_count: number
          pdf_score: number | null
          pdf_status: string
          pdf_url: string | null
          pdf_worksheet_score: number | null
          pipeline_status: Database["public"]["Enums"]["pipeline_status"]
          practical_tool_score: number | null
          premium_score: number | null
          preview_blurb: string | null
          preview_page_count: number
          price: number
          price_confidence_score: number | null
          price_rationale: Json | null
          price_tier: string | null
          pricing_computed_at: string | null
          pricing_confidence_score: number | null
          pricing_report: Json | null
          pricing_tier: string | null
          product_copy: Json
          product_description: string | null
          product_page_qc: Json
          product_page_qc_score: number | null
          product_type: string
          progress_pct: number | null
          progress_percent: number | null
          qc: Json
          qc_downgraded: boolean
          qc_gates_json: Json | null
          qc_notes: string | null
          qc_status: string | null
          queue_position: number | null
          queued_at: string | null
          re_render_count: number
          re_render_last_at: string | null
          re_render_reason: string | null
          reader_experience_attempted_at: string | null
          reader_experience_fix_count: number
          reader_experience_qc: Json | null
          reader_experience_score: number | null
          reader_experience_status: string | null
          reader_value_score: number | null
          recommended_price: number | null
          refund_risk_score: number | null
          rejection_reason: string | null
          required_score: number | null
          resolved_at: string | null
          sales_count: number
          selling_hook: string | null
          seo_meta: string | null
          seo_title: string | null
          series_id: string | null
          shopping_card_description: string | null
          short_hook: string | null
          standard_price: number | null
          status: string
          store_thumbnail_generated_at: string | null
          store_thumbnail_qc: Json | null
          store_thumbnail_url: string | null
          storefront_subtitle: string | null
          storefront_title: string | null
          structured_error: Json | null
          subtitle: string | null
          tags: string[]
          target_buyer: string | null
          text_density_score: number | null
          thumbnail_needs_review: boolean
          thumbnail_qc_score: number | null
          thumbnail_url: string | null
          title: string
          toc: Json
          total_word_count: number | null
          updated_at: string
          url_slug: string | null
          vendor: string
          visual_fatigue_score: number | null
          visual_plan: Json
          waiting_reason: string | null
          what_you_get: Json | null
          whats_inside: Json | null
          who_it_is_for: string | null
          who_its_for: Json | null
          who_its_not_for: Json | null
          word_count: number
          worksheet_previews_json: Json | null
          worksheet_readability_score: number | null
          worksheet_table_overflow_score: number | null
          writing_status: string
        }
        Insert: {
          action_plan_json?: Json | null
          admin_review_reason?: string | null
          auto_approved?: boolean
          auto_fix_attempt_count?: number
          auto_fix_attempts?: number
          auto_fix_history?: Json
          auto_publish?: boolean
          autofix_attempt?: number | null
          autofix_max?: number | null
          autopilot_mode?: string
          autopilot_state?: string
          benefit_bullets?: Json | null
          blocked_at?: string | null
          blocker_class?: string | null
          blocker_reason?: string | null
          body_html?: string | null
          bonus_section_json?: Json | null
          bonuses?: Json
          browserless_retry_count?: number
          bundle_price_recommendation?: number | null
          buyer_appeal_score?: number | null
          canonical_status?: string | null
          category_id?: string | null
          category_slug?: string | null
          chapter_qc?: Json
          chapters?: Json
          cliffhanger_hook?: string | null
          compare_at_price?: number | null
          compliance_rewrites_json?: Json | null
          compliance_safety_score?: number | null
          content_depth_score?: number | null
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
          current_action_message?: string | null
          current_qc_score?: number | null
          current_step?: string | null
          current_step_label?: string | null
          current_subtask?: string | null
          editorial_polish_score?: number | null
          editorial_qc?: Json
          estimated_start_after_run_id?: string | null
          failed_component?: string | null
          failed_gate?: string | null
          failed_score?: number | null
          final_approved?: boolean
          final_approved_at?: string | null
          final_approved_by?: string | null
          final_manuscript_qc?: Json
          final_manuscript_score?: number | null
          final_quality_score?: number | null
          hard_sell_strength_score?: number | null
          high_price_test?: number | null
          hook?: string | null
          hook_description?: string | null
          id?: string
          idea_id?: string | null
          inside_illustration_plan_json?: Json | null
          inside_illustration_relevance_score?: number | null
          inside_illustrations_json?: Json | null
          interior_visuals?: Json | null
          is_bestseller?: boolean
          key_benefits?: Json | null
          kids_scene_briefs_json?: Json | null
          kids_visual_bible?: Json | null
          last_auto_fix_action?: string | null
          last_heartbeat_at?: string | null
          launch_price?: number | null
          listed_at?: string | null
          listing_status?: string
          long_description?: string | null
          low_price_test?: number | null
          manuscript_fix_count?: number
          manuscript_qc_status?: string | null
          max_auto_fix_attempts?: number
          memory_state?: Json
          meta_description?: string | null
          metadata?: Json
          needs_review_reason?: string | null
          next_recommended_action?: string | null
          next_retry_at?: string | null
          outline?: Json
          outline_json?: Json
          outline_qc?: Json
          outline_rewrite_count?: number
          pdf_approved?: boolean
          pdf_diagram_score?: number | null
          pdf_generated_at?: string | null
          pdf_html_url?: string | null
          pdf_layout_score?: number | null
          pdf_page_count?: number | null
          pdf_qc?: Json | null
          pdf_readability_score?: number | null
          pdf_render_count?: number
          pdf_score?: number | null
          pdf_status?: string
          pdf_url?: string | null
          pdf_worksheet_score?: number | null
          pipeline_status?: Database["public"]["Enums"]["pipeline_status"]
          practical_tool_score?: number | null
          premium_score?: number | null
          preview_blurb?: string | null
          preview_page_count?: number
          price?: number
          price_confidence_score?: number | null
          price_rationale?: Json | null
          price_tier?: string | null
          pricing_computed_at?: string | null
          pricing_confidence_score?: number | null
          pricing_report?: Json | null
          pricing_tier?: string | null
          product_copy?: Json
          product_description?: string | null
          product_page_qc?: Json
          product_page_qc_score?: number | null
          product_type?: string
          progress_pct?: number | null
          progress_percent?: number | null
          qc?: Json
          qc_downgraded?: boolean
          qc_gates_json?: Json | null
          qc_notes?: string | null
          qc_status?: string | null
          queue_position?: number | null
          queued_at?: string | null
          re_render_count?: number
          re_render_last_at?: string | null
          re_render_reason?: string | null
          reader_experience_attempted_at?: string | null
          reader_experience_fix_count?: number
          reader_experience_qc?: Json | null
          reader_experience_score?: number | null
          reader_experience_status?: string | null
          reader_value_score?: number | null
          recommended_price?: number | null
          refund_risk_score?: number | null
          rejection_reason?: string | null
          required_score?: number | null
          resolved_at?: string | null
          sales_count?: number
          selling_hook?: string | null
          seo_meta?: string | null
          seo_title?: string | null
          series_id?: string | null
          shopping_card_description?: string | null
          short_hook?: string | null
          standard_price?: number | null
          status?: string
          store_thumbnail_generated_at?: string | null
          store_thumbnail_qc?: Json | null
          store_thumbnail_url?: string | null
          storefront_subtitle?: string | null
          storefront_title?: string | null
          structured_error?: Json | null
          subtitle?: string | null
          tags?: string[]
          target_buyer?: string | null
          text_density_score?: number | null
          thumbnail_needs_review?: boolean
          thumbnail_qc_score?: number | null
          thumbnail_url?: string | null
          title: string
          toc?: Json
          total_word_count?: number | null
          updated_at?: string
          url_slug?: string | null
          vendor?: string
          visual_fatigue_score?: number | null
          visual_plan?: Json
          waiting_reason?: string | null
          what_you_get?: Json | null
          whats_inside?: Json | null
          who_it_is_for?: string | null
          who_its_for?: Json | null
          who_its_not_for?: Json | null
          word_count?: number
          worksheet_previews_json?: Json | null
          worksheet_readability_score?: number | null
          worksheet_table_overflow_score?: number | null
          writing_status?: string
        }
        Update: {
          action_plan_json?: Json | null
          admin_review_reason?: string | null
          auto_approved?: boolean
          auto_fix_attempt_count?: number
          auto_fix_attempts?: number
          auto_fix_history?: Json
          auto_publish?: boolean
          autofix_attempt?: number | null
          autofix_max?: number | null
          autopilot_mode?: string
          autopilot_state?: string
          benefit_bullets?: Json | null
          blocked_at?: string | null
          blocker_class?: string | null
          blocker_reason?: string | null
          body_html?: string | null
          bonus_section_json?: Json | null
          bonuses?: Json
          browserless_retry_count?: number
          bundle_price_recommendation?: number | null
          buyer_appeal_score?: number | null
          canonical_status?: string | null
          category_id?: string | null
          category_slug?: string | null
          chapter_qc?: Json
          chapters?: Json
          cliffhanger_hook?: string | null
          compare_at_price?: number | null
          compliance_rewrites_json?: Json | null
          compliance_safety_score?: number | null
          content_depth_score?: number | null
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
          current_action_message?: string | null
          current_qc_score?: number | null
          current_step?: string | null
          current_step_label?: string | null
          current_subtask?: string | null
          editorial_polish_score?: number | null
          editorial_qc?: Json
          estimated_start_after_run_id?: string | null
          failed_component?: string | null
          failed_gate?: string | null
          failed_score?: number | null
          final_approved?: boolean
          final_approved_at?: string | null
          final_approved_by?: string | null
          final_manuscript_qc?: Json
          final_manuscript_score?: number | null
          final_quality_score?: number | null
          hard_sell_strength_score?: number | null
          high_price_test?: number | null
          hook?: string | null
          hook_description?: string | null
          id?: string
          idea_id?: string | null
          inside_illustration_plan_json?: Json | null
          inside_illustration_relevance_score?: number | null
          inside_illustrations_json?: Json | null
          interior_visuals?: Json | null
          is_bestseller?: boolean
          key_benefits?: Json | null
          kids_scene_briefs_json?: Json | null
          kids_visual_bible?: Json | null
          last_auto_fix_action?: string | null
          last_heartbeat_at?: string | null
          launch_price?: number | null
          listed_at?: string | null
          listing_status?: string
          long_description?: string | null
          low_price_test?: number | null
          manuscript_fix_count?: number
          manuscript_qc_status?: string | null
          max_auto_fix_attempts?: number
          memory_state?: Json
          meta_description?: string | null
          metadata?: Json
          needs_review_reason?: string | null
          next_recommended_action?: string | null
          next_retry_at?: string | null
          outline?: Json
          outline_json?: Json
          outline_qc?: Json
          outline_rewrite_count?: number
          pdf_approved?: boolean
          pdf_diagram_score?: number | null
          pdf_generated_at?: string | null
          pdf_html_url?: string | null
          pdf_layout_score?: number | null
          pdf_page_count?: number | null
          pdf_qc?: Json | null
          pdf_readability_score?: number | null
          pdf_render_count?: number
          pdf_score?: number | null
          pdf_status?: string
          pdf_url?: string | null
          pdf_worksheet_score?: number | null
          pipeline_status?: Database["public"]["Enums"]["pipeline_status"]
          practical_tool_score?: number | null
          premium_score?: number | null
          preview_blurb?: string | null
          preview_page_count?: number
          price?: number
          price_confidence_score?: number | null
          price_rationale?: Json | null
          price_tier?: string | null
          pricing_computed_at?: string | null
          pricing_confidence_score?: number | null
          pricing_report?: Json | null
          pricing_tier?: string | null
          product_copy?: Json
          product_description?: string | null
          product_page_qc?: Json
          product_page_qc_score?: number | null
          product_type?: string
          progress_pct?: number | null
          progress_percent?: number | null
          qc?: Json
          qc_downgraded?: boolean
          qc_gates_json?: Json | null
          qc_notes?: string | null
          qc_status?: string | null
          queue_position?: number | null
          queued_at?: string | null
          re_render_count?: number
          re_render_last_at?: string | null
          re_render_reason?: string | null
          reader_experience_attempted_at?: string | null
          reader_experience_fix_count?: number
          reader_experience_qc?: Json | null
          reader_experience_score?: number | null
          reader_experience_status?: string | null
          reader_value_score?: number | null
          recommended_price?: number | null
          refund_risk_score?: number | null
          rejection_reason?: string | null
          required_score?: number | null
          resolved_at?: string | null
          sales_count?: number
          selling_hook?: string | null
          seo_meta?: string | null
          seo_title?: string | null
          series_id?: string | null
          shopping_card_description?: string | null
          short_hook?: string | null
          standard_price?: number | null
          status?: string
          store_thumbnail_generated_at?: string | null
          store_thumbnail_qc?: Json | null
          store_thumbnail_url?: string | null
          storefront_subtitle?: string | null
          storefront_title?: string | null
          structured_error?: Json | null
          subtitle?: string | null
          tags?: string[]
          target_buyer?: string | null
          text_density_score?: number | null
          thumbnail_needs_review?: boolean
          thumbnail_qc_score?: number | null
          thumbnail_url?: string | null
          title?: string
          toc?: Json
          total_word_count?: number | null
          updated_at?: string
          url_slug?: string | null
          vendor?: string
          visual_fatigue_score?: number | null
          visual_plan?: Json
          waiting_reason?: string | null
          what_you_get?: Json | null
          whats_inside?: Json | null
          who_it_is_for?: string | null
          who_its_for?: Json | null
          who_its_not_for?: Json | null
          word_count?: number
          worksheet_previews_json?: Json | null
          worksheet_readability_score?: number | null
          worksheet_table_overflow_score?: number | null
          writing_status?: string
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
          {
            foreignKeyName: "ebooks_series_id_fkey"
            columns: ["series_id"]
            isOneToOne: false
            referencedRelation: "book_series"
            referencedColumns: ["id"]
          },
        ]
      }
      ebooks_kids: {
        Row: {
          age_group_id: string | null
          blocker_reason: string | null
          book_type: Database["public"]["Enums"]["kids_book_type"]
          character_bible_id: string | null
          character_reference_id: string | null
          character_sheet_url: string | null
          cover_url: string | null
          created_at: string
          customer_product_description_html: string | null
          description: string | null
          ever_live: boolean
          human_review_reason: string | null
          id: string
          identity_locked_at: string | null
          interior_illustrations: Json | null
          internal_story_brief_json: Json | null
          listing_status: string
          locked: boolean
          manuscript_md: string | null
          overall_qc_score: number | null
          page_count: number | null
          pdf_byte_size: number | null
          pdf_metadata_derived_at: string | null
          pdf_sha256: string | null
          pdf_url: string | null
          pipeline_status: string
          preview_page_urls: Json | null
          price_cents: number
          qc_rule_version: string | null
          qc_scorecard: Json
          qc_scores: Json | null
          rehydrated_from: string | null
          sales_copy_sanitized_at: string | null
          sellable: boolean
          status: string
          storefront_meta: Json
          storefront_subtitle: string | null
          storefront_title: string | null
          story_bible: Json | null
          story_bible_id: string | null
          style_bible_json: Json | null
          style_version: string | null
          subtitle: string | null
          theme_ids: string[]
          thumbnail_url: string | null
          title: string
          updated_at: string
          word_count: number | null
        }
        Insert: {
          age_group_id?: string | null
          blocker_reason?: string | null
          book_type?: Database["public"]["Enums"]["kids_book_type"]
          character_bible_id?: string | null
          character_reference_id?: string | null
          character_sheet_url?: string | null
          cover_url?: string | null
          created_at?: string
          customer_product_description_html?: string | null
          description?: string | null
          ever_live?: boolean
          human_review_reason?: string | null
          id?: string
          identity_locked_at?: string | null
          interior_illustrations?: Json | null
          internal_story_brief_json?: Json | null
          listing_status?: string
          locked?: boolean
          manuscript_md?: string | null
          overall_qc_score?: number | null
          page_count?: number | null
          pdf_byte_size?: number | null
          pdf_metadata_derived_at?: string | null
          pdf_sha256?: string | null
          pdf_url?: string | null
          pipeline_status?: string
          preview_page_urls?: Json | null
          price_cents?: number
          qc_rule_version?: string | null
          qc_scorecard?: Json
          qc_scores?: Json | null
          rehydrated_from?: string | null
          sales_copy_sanitized_at?: string | null
          sellable?: boolean
          status?: string
          storefront_meta?: Json
          storefront_subtitle?: string | null
          storefront_title?: string | null
          story_bible?: Json | null
          story_bible_id?: string | null
          style_bible_json?: Json | null
          style_version?: string | null
          subtitle?: string | null
          theme_ids?: string[]
          thumbnail_url?: string | null
          title?: string
          updated_at?: string
          word_count?: number | null
        }
        Update: {
          age_group_id?: string | null
          blocker_reason?: string | null
          book_type?: Database["public"]["Enums"]["kids_book_type"]
          character_bible_id?: string | null
          character_reference_id?: string | null
          character_sheet_url?: string | null
          cover_url?: string | null
          created_at?: string
          customer_product_description_html?: string | null
          description?: string | null
          ever_live?: boolean
          human_review_reason?: string | null
          id?: string
          identity_locked_at?: string | null
          interior_illustrations?: Json | null
          internal_story_brief_json?: Json | null
          listing_status?: string
          locked?: boolean
          manuscript_md?: string | null
          overall_qc_score?: number | null
          page_count?: number | null
          pdf_byte_size?: number | null
          pdf_metadata_derived_at?: string | null
          pdf_sha256?: string | null
          pdf_url?: string | null
          pipeline_status?: string
          preview_page_urls?: Json | null
          price_cents?: number
          qc_rule_version?: string | null
          qc_scorecard?: Json
          qc_scores?: Json | null
          rehydrated_from?: string | null
          sales_copy_sanitized_at?: string | null
          sellable?: boolean
          status?: string
          storefront_meta?: Json
          storefront_subtitle?: string | null
          storefront_title?: string | null
          story_bible?: Json | null
          story_bible_id?: string | null
          style_bible_json?: Json | null
          style_version?: string | null
          subtitle?: string | null
          theme_ids?: string[]
          thumbnail_url?: string | null
          title?: string
          updated_at?: string
          word_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ebooks_kids_age_group_id_fkey"
            columns: ["age_group_id"]
            isOneToOne: false
            referencedRelation: "kids_age_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ebooks_kids_rehydrated_from_fkey"
            columns: ["rehydrated_from"]
            isOneToOne: false
            referencedRelation: "ebooks_kids"
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
          auto_rewrite_limit: number
          autopilot_enabled: boolean
          autopilot_mode: string
          browserless_concurrency: number
          category_mix: Json
          cost_limit_reached: boolean
          cost_limit_reached_at: string | null
          cost_limit_reason: string | null
          cron_enabled: boolean
          daily_budget_usd: number
          daily_cost_cap_usd: number
          daily_quota: number
          enabled_categories_json: Json
          enabled_category_ids: string[]
          heavy_production_concurrency: number
          id: number
          idea_generation_concurrency: number
          last_tick_at: string | null
          last_tick_result: Json | null
          max_ai_calls_per_ebook: number
          max_books_per_day: number
          max_parallel_books: number
          max_parallel_heavy_jobs: number
          max_refund_risk: number
          max_rewrite_attempts: number
          min_score_threshold: number
          min_word_count: number
          minimum_qc_pass_rate: number
          mode: Database["public"]["Enums"]["generation_mode"]
          pause_when_cost_limit_reached: boolean
          pause_when_qc_pass_rate_low: boolean
          paused: boolean
          pdf_render_concurrency: number
          per_ebook_budget_usd: number
          publish_hour_utc: number
          quality_first_mode: boolean
          safe_publish_to_store: boolean
          sequential_safe_mode: boolean
          stuck_run_ttl_min: number
          tick_enabled: boolean
          updated_at: string
        }
        Insert: {
          auto_publish?: boolean
          auto_rewrite_limit?: number
          autopilot_enabled?: boolean
          autopilot_mode?: string
          browserless_concurrency?: number
          category_mix?: Json
          cost_limit_reached?: boolean
          cost_limit_reached_at?: string | null
          cost_limit_reason?: string | null
          cron_enabled?: boolean
          daily_budget_usd?: number
          daily_cost_cap_usd?: number
          daily_quota?: number
          enabled_categories_json?: Json
          enabled_category_ids?: string[]
          heavy_production_concurrency?: number
          id?: number
          idea_generation_concurrency?: number
          last_tick_at?: string | null
          last_tick_result?: Json | null
          max_ai_calls_per_ebook?: number
          max_books_per_day?: number
          max_parallel_books?: number
          max_parallel_heavy_jobs?: number
          max_refund_risk?: number
          max_rewrite_attempts?: number
          min_score_threshold?: number
          min_word_count?: number
          minimum_qc_pass_rate?: number
          mode?: Database["public"]["Enums"]["generation_mode"]
          pause_when_cost_limit_reached?: boolean
          pause_when_qc_pass_rate_low?: boolean
          paused?: boolean
          pdf_render_concurrency?: number
          per_ebook_budget_usd?: number
          publish_hour_utc?: number
          quality_first_mode?: boolean
          safe_publish_to_store?: boolean
          sequential_safe_mode?: boolean
          stuck_run_ttl_min?: number
          tick_enabled?: boolean
          updated_at?: string
        }
        Update: {
          auto_publish?: boolean
          auto_rewrite_limit?: number
          autopilot_enabled?: boolean
          autopilot_mode?: string
          browserless_concurrency?: number
          category_mix?: Json
          cost_limit_reached?: boolean
          cost_limit_reached_at?: string | null
          cost_limit_reason?: string | null
          cron_enabled?: boolean
          daily_budget_usd?: number
          daily_cost_cap_usd?: number
          daily_quota?: number
          enabled_categories_json?: Json
          enabled_category_ids?: string[]
          heavy_production_concurrency?: number
          id?: number
          idea_generation_concurrency?: number
          last_tick_at?: string | null
          last_tick_result?: Json | null
          max_ai_calls_per_ebook?: number
          max_books_per_day?: number
          max_parallel_books?: number
          max_parallel_heavy_jobs?: number
          max_refund_risk?: number
          max_rewrite_attempts?: number
          min_score_threshold?: number
          min_word_count?: number
          minimum_qc_pass_rate?: number
          mode?: Database["public"]["Enums"]["generation_mode"]
          pause_when_cost_limit_reached?: boolean
          pause_when_qc_pass_rate_low?: boolean
          paused?: boolean
          pdf_render_concurrency?: number
          per_ebook_budget_usd?: number
          publish_hour_utc?: number
          quality_first_mode?: boolean
          safe_publish_to_store?: boolean
          sequential_safe_mode?: boolean
          stuck_run_ttl_min?: number
          tick_enabled?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      kids_age_groups: {
        Row: {
          created_at: string
          id: string
          label_en: string
          label_th: string
          max_age: number
          min_age: number
          slug: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          id?: string
          label_en: string
          label_th: string
          max_age: number
          min_age: number
          slug: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          id?: string
          label_en?: string
          label_th?: string
          max_age?: number
          min_age?: number
          slug?: string
          sort_order?: number
        }
        Relationships: []
      }
      kids_batch_orders: {
        Row: {
          counted_ebook_ids: string[]
          created_at: string
          id: string
          last_used_lane: string | null
          last_used_theme_id: string | null
          notes: string | null
          produced_live: number
          status: string
          target_live_books: number
          updated_at: string
        }
        Insert: {
          counted_ebook_ids?: string[]
          created_at?: string
          id?: string
          last_used_lane?: string | null
          last_used_theme_id?: string | null
          notes?: string | null
          produced_live?: number
          status?: string
          target_live_books: number
          updated_at?: string
        }
        Update: {
          counted_ebook_ids?: string[]
          created_at?: string
          id?: string
          last_used_lane?: string | null
          last_used_theme_id?: string | null
          notes?: string | null
          produced_live?: number
          status?: string
          target_live_books?: number
          updated_at?: string
        }
        Relationships: []
      }
      kids_book_bibles: {
        Row: {
          character_bible_json: Json
          character_reference_image_url: string | null
          cover_master_url: string | null
          created_at: string
          ebook_id: string
          id: string
          locked_at: string | null
          locked_by: string | null
          style_bible_json: Json
          style_preset_id: string | null
          style_slug: string | null
          updated_at: string
        }
        Insert: {
          character_bible_json?: Json
          character_reference_image_url?: string | null
          cover_master_url?: string | null
          created_at?: string
          ebook_id: string
          id?: string
          locked_at?: string | null
          locked_by?: string | null
          style_bible_json?: Json
          style_preset_id?: string | null
          style_slug?: string | null
          updated_at?: string
        }
        Update: {
          character_bible_json?: Json
          character_reference_image_url?: string | null
          cover_master_url?: string | null
          created_at?: string
          ebook_id?: string
          id?: string
          locked_at?: string | null
          locked_by?: string | null
          style_bible_json?: Json
          style_preset_id?: string | null
          style_slug?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "kids_book_bibles_ebook_id_fkey"
            columns: ["ebook_id"]
            isOneToOne: true
            referencedRelation: "ebooks_kids"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kids_book_bibles_style_preset_id_fkey"
            columns: ["style_preset_id"]
            isOneToOne: false
            referencedRelation: "kids_style_presets"
            referencedColumns: ["id"]
          },
        ]
      }
      kids_category_weights: {
        Row: {
          age_group_id: string
          auto_managed: boolean
          created_at: string
          id: string
          sales_last_30d: number
          theme_id: string
          updated_at: string
          weight: number
        }
        Insert: {
          age_group_id: string
          auto_managed?: boolean
          created_at?: string
          id?: string
          sales_last_30d?: number
          theme_id: string
          updated_at?: string
          weight?: number
        }
        Update: {
          age_group_id?: string
          auto_managed?: boolean
          created_at?: string
          id?: string
          sales_last_30d?: number
          theme_id?: string
          updated_at?: string
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "kids_category_weights_age_group_id_fkey"
            columns: ["age_group_id"]
            isOneToOne: false
            referencedRelation: "kids_age_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kids_category_weights_theme_id_fkey"
            columns: ["theme_id"]
            isOneToOne: false
            referencedRelation: "kids_themes"
            referencedColumns: ["id"]
          },
        ]
      }
      kids_download_grants: {
        Row: {
          created_at: string
          download_count: number
          ebook_kids_id: string
          email: string
          expires_at: string
          id: string
          last_downloaded_at: string | null
          max_downloads: number
          order_id: string | null
          token: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          download_count?: number
          ebook_kids_id: string
          email: string
          expires_at?: string
          id?: string
          last_downloaded_at?: string | null
          max_downloads?: number
          order_id?: string | null
          token: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          download_count?: number
          ebook_kids_id?: string
          email?: string
          expires_at?: string
          id?: string
          last_downloaded_at?: string | null
          max_downloads?: number
          order_id?: string | null
          token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "kids_download_grants_ebook_kids_id_fkey"
            columns: ["ebook_kids_id"]
            isOneToOne: false
            referencedRelation: "ebooks_kids"
            referencedColumns: ["id"]
          },
        ]
      }
      kids_launch_leads: {
        Row: {
          created_at: string
          ebook_id: string | null
          email: string
          id: string
          metadata: Json
          source: string
        }
        Insert: {
          created_at?: string
          ebook_id?: string | null
          email: string
          id?: string
          metadata?: Json
          source?: string
        }
        Update: {
          created_at?: string
          ebook_id?: string | null
          email?: string
          id?: string
          metadata?: Json
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "kids_launch_leads_ebook_id_fkey"
            columns: ["ebook_id"]
            isOneToOne: false
            referencedRelation: "ebooks_kids"
            referencedColumns: ["id"]
          },
        ]
      }
      kids_production_queue: {
        Row: {
          age_group_id: string | null
          attempts: number
          claimed_at: string | null
          completed_at: string | null
          created_at: string
          ebook_kids_id: string | null
          id: string
          last_error: string | null
          priority: number
          status: string
          theme_id: string | null
          updated_at: string
        }
        Insert: {
          age_group_id?: string | null
          attempts?: number
          claimed_at?: string | null
          completed_at?: string | null
          created_at?: string
          ebook_kids_id?: string | null
          id?: string
          last_error?: string | null
          priority?: number
          status?: string
          theme_id?: string | null
          updated_at?: string
        }
        Update: {
          age_group_id?: string | null
          attempts?: number
          claimed_at?: string | null
          completed_at?: string | null
          created_at?: string
          ebook_kids_id?: string | null
          id?: string
          last_error?: string | null
          priority?: number
          status?: string
          theme_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "kids_production_queue_age_group_id_fkey"
            columns: ["age_group_id"]
            isOneToOne: false
            referencedRelation: "kids_age_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kids_production_queue_ebook_kids_id_fkey"
            columns: ["ebook_kids_id"]
            isOneToOne: false
            referencedRelation: "ebooks_kids"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kids_production_queue_theme_id_fkey"
            columns: ["theme_id"]
            isOneToOne: false
            referencedRelation: "kids_themes"
            referencedColumns: ["id"]
          },
        ]
      }
      kids_style_presets: {
        Row: {
          created_at: string
          enabled: boolean
          id: string
          label: string
          last_used_at: string | null
          negative_prompt: string | null
          prompt_suffix: string
          slug: string
          times_used: number
          updated_at: string
          weight: number
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          id?: string
          label: string
          last_used_at?: string | null
          negative_prompt?: string | null
          prompt_suffix: string
          slug: string
          times_used?: number
          updated_at?: string
          weight?: number
        }
        Update: {
          created_at?: string
          enabled?: boolean
          id?: string
          label?: string
          last_used_at?: string | null
          negative_prompt?: string | null
          prompt_suffix?: string
          slug?: string
          times_used?: number
          updated_at?: string
          weight?: number
        }
        Relationships: []
      }
      kids_themes: {
        Row: {
          created_at: string
          icon_name: string | null
          id: string
          label_en: string
          label_th: string
          slug: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          icon_name?: string | null
          id?: string
          label_en: string
          label_th: string
          slug: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          icon_name?: string | null
          id?: string
          label_en?: string
          label_th?: string
          slug?: string
          sort_order?: number
        }
        Relationships: []
      }
      market_intelligence: {
        Row: {
          category_id: string | null
          created_at: string
          id: string
          metadata: Json
          research_payload: Json
          source: string | null
          topic: string | null
          trend_score: number | null
          updated_at: string
        }
        Insert: {
          category_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          research_payload?: Json
          source?: string | null
          topic?: string | null
          trend_score?: number | null
          updated_at?: string
        }
        Update: {
          category_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          research_payload?: Json
          source?: string | null
          topic?: string | null
          trend_score?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "market_intelligence_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          cover_snapshot: string | null
          created_at: string
          currency: string
          ebook_id: string
          id: string
          order_id: string
          title_snapshot: string
          unit_price: number
        }
        Insert: {
          cover_snapshot?: string | null
          created_at?: string
          currency?: string
          ebook_id: string
          id?: string
          order_id: string
          title_snapshot: string
          unit_price: number
        }
        Update: {
          cover_snapshot?: string | null
          created_at?: string
          currency?: string
          ebook_id?: string
          id?: string
          order_id?: string
          title_snapshot?: string
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_items_ebook_id_fkey"
            columns: ["ebook_id"]
            isOneToOne: false
            referencedRelation: "ebooks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          amount_total: number
          buyer_email: string
          buyer_user_id: string | null
          created_at: string
          currency: string
          environment: string
          id: string
          paid_at: string | null
          status: string
          stripe_payment_intent: string | null
          stripe_session_id: string | null
          updated_at: string
        }
        Insert: {
          amount_total?: number
          buyer_email: string
          buyer_user_id?: string | null
          created_at?: string
          currency?: string
          environment?: string
          id?: string
          paid_at?: string | null
          status?: string
          stripe_payment_intent?: string | null
          stripe_session_id?: string | null
          updated_at?: string
        }
        Update: {
          amount_total?: number
          buyer_email?: string
          buyer_user_id?: string | null
          created_at?: string
          currency?: string
          environment?: string
          id?: string
          paid_at?: string | null
          status?: string
          stripe_payment_intent?: string | null
          stripe_session_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      pipeline_skills: {
        Row: {
          age_band: string | null
          content_md: string
          created_at: string
          id: string
          metadata: Json
          skill_key: string
          sort_index: number
          source: string
          target_dimension: string | null
          updated_at: string
          version: number
        }
        Insert: {
          age_band?: string | null
          content_md: string
          created_at?: string
          id?: string
          metadata?: Json
          skill_key: string
          sort_index?: number
          source?: string
          target_dimension?: string | null
          updated_at?: string
          version?: number
        }
        Update: {
          age_band?: string | null
          content_md?: string
          created_at?: string
          id?: string
          metadata?: Json
          skill_key?: string
          sort_index?: number
          source?: string
          target_dimension?: string | null
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      pipeline_step_logs: {
        Row: {
          completed_at: string | null
          cost_estimate: number
          created_at: string
          duration_ms: number | null
          ebook_id: string | null
          error_message: string | null
          id: string
          idea_id: string | null
          payload: Json
          retry_count: number
          started_at: string
          status: string
          step_name: string
        }
        Insert: {
          completed_at?: string | null
          cost_estimate?: number
          created_at?: string
          duration_ms?: number | null
          ebook_id?: string | null
          error_message?: string | null
          id?: string
          idea_id?: string | null
          payload?: Json
          retry_count?: number
          started_at?: string
          status: string
          step_name: string
        }
        Update: {
          completed_at?: string | null
          cost_estimate?: number
          created_at?: string
          duration_ms?: number | null
          ebook_id?: string | null
          error_message?: string | null
          id?: string
          idea_id?: string | null
          payload?: Json
          retry_count?: number
          started_at?: string
          status?: string
          step_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_step_logs_ebook_id_fkey"
            columns: ["ebook_id"]
            isOneToOne: false
            referencedRelation: "ebooks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipeline_step_logs_idea_id_fkey"
            columns: ["idea_id"]
            isOneToOne: false
            referencedRelation: "ebook_ideas"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_settings: {
        Row: {
          key: string
          updated_at: string
          value_json: Json
        }
        Insert: {
          key: string
          updated_at?: string
          value_json: Json
        }
        Update: {
          key?: string
          updated_at?: string
          value_json?: Json
        }
        Relationships: []
      }
      product_reviews: {
        Row: {
          comment: string | null
          created_at: string
          ebook_id: string
          id: string
          rating: number
          reviewer_name: string
          updated_at: string
          verified_purchase: boolean
        }
        Insert: {
          comment?: string | null
          created_at?: string
          ebook_id: string
          id?: string
          rating: number
          reviewer_name: string
          updated_at?: string
          verified_purchase?: boolean
        }
        Update: {
          comment?: string | null
          created_at?: string
          ebook_id?: string
          id?: string
          rating?: number
          reviewer_name?: string
          updated_at?: string
          verified_purchase?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "product_reviews_ebook_id_fkey"
            columns: ["ebook_id"]
            isOneToOne: false
            referencedRelation: "ebooks"
            referencedColumns: ["id"]
          },
        ]
      }
      production_locks: {
        Row: {
          acquired_at: string
          expires_at: string
          holder_ebook_id: string | null
          holder_run_id: string | null
          metadata: Json
          name: string
        }
        Insert: {
          acquired_at?: string
          expires_at: string
          holder_ebook_id?: string | null
          holder_run_id?: string | null
          metadata?: Json
          name: string
        }
        Update: {
          acquired_at?: string
          expires_at?: string
          holder_ebook_id?: string | null
          holder_run_id?: string | null
          metadata?: Json
          name?: string
        }
        Relationships: []
      }
      production_queue: {
        Row: {
          attempts: number
          created_at: string
          ebook_id: string | null
          id: string
          idea_id: string | null
          last_error: string | null
          metadata: Json
          payload: Json
          pipeline_status: Database["public"]["Enums"]["pipeline_status"]
          priority: number
          scheduled_at: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          ebook_id?: string | null
          id?: string
          idea_id?: string | null
          last_error?: string | null
          metadata?: Json
          payload?: Json
          pipeline_status?: Database["public"]["Enums"]["pipeline_status"]
          priority?: number
          scheduled_at?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          ebook_id?: string | null
          id?: string
          idea_id?: string | null
          last_error?: string | null
          metadata?: Json
          payload?: Json
          pipeline_status?: Database["public"]["Enums"]["pipeline_status"]
          priority?: number
          scheduled_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_queue_ebook_id_fkey"
            columns: ["ebook_id"]
            isOneToOne: false
            referencedRelation: "ebooks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_queue_idea_id_fkey"
            columns: ["idea_id"]
            isOneToOne: false
            referencedRelation: "ebook_ideas"
            referencedColumns: ["id"]
          },
        ]
      }
      production_slowdowns: {
        Row: {
          concept_at: string | null
          created_at: string
          ebook_kids_id: string | null
          id: string
          live_at: string | null
          notes: string | null
          run_id: string | null
          sla_minutes: number
          slowest_stage: string | null
          slowest_stage_minutes: number | null
          stage_breakdown: Json
          total_minutes: number
          watchdog_rescues: number
        }
        Insert: {
          concept_at?: string | null
          created_at?: string
          ebook_kids_id?: string | null
          id?: string
          live_at?: string | null
          notes?: string | null
          run_id?: string | null
          sla_minutes?: number
          slowest_stage?: string | null
          slowest_stage_minutes?: number | null
          stage_breakdown?: Json
          total_minutes: number
          watchdog_rescues?: number
        }
        Update: {
          concept_at?: string | null
          created_at?: string
          ebook_kids_id?: string | null
          id?: string
          live_at?: string | null
          notes?: string | null
          run_id?: string | null
          sla_minutes?: number
          slowest_stage?: string | null
          slowest_stage_minutes?: number | null
          stage_breakdown?: Json
          total_minutes?: number
          watchdog_rescues?: number
        }
        Relationships: []
      }
      qc_findings: {
        Row: {
          category: string
          created_at: string
          ebook_id: string
          ebook_track: string
          evidence_url: string | null
          id: string
          measured_value: Json
          page_number: number | null
          passed: boolean
          qc_rule_version: string | null
          repair_action: string | null
          repair_attempts: number
          rule_id: string
          run_id: string | null
          severity: string
          threshold: Json
          updated_at: string
          verification_result: Json
        }
        Insert: {
          category: string
          created_at?: string
          ebook_id: string
          ebook_track?: string
          evidence_url?: string | null
          id?: string
          measured_value?: Json
          page_number?: number | null
          passed: boolean
          qc_rule_version?: string | null
          repair_action?: string | null
          repair_attempts?: number
          rule_id: string
          run_id?: string | null
          severity: string
          threshold?: Json
          updated_at?: string
          verification_result?: Json
        }
        Update: {
          category?: string
          created_at?: string
          ebook_id?: string
          ebook_track?: string
          evidence_url?: string | null
          id?: string
          measured_value?: Json
          page_number?: number | null
          passed?: boolean
          qc_rule_version?: string | null
          repair_action?: string | null
          repair_attempts?: number
          rule_id?: string
          run_id?: string | null
          severity?: string
          threshold?: Json
          updated_at?: string
          verification_result?: Json
        }
        Relationships: []
      }
      qc_reports: {
        Row: {
          buyer_appeal_score: number | null
          chapter_id: string | null
          compliance_safety_score: number | null
          content_depth_score: number | null
          cover_score: number | null
          created_at: string
          ebook_id: string | null
          final_quality_score: number | null
          hard_sell_strength_score: number | null
          id: string
          idea_id: string | null
          metadata: Json
          passed: boolean | null
          pdf_layout_score: number | null
          premium_score: number | null
          raw_report: Json
          stage: Database["public"]["Enums"]["pipeline_status"]
          updated_at: string
        }
        Insert: {
          buyer_appeal_score?: number | null
          chapter_id?: string | null
          compliance_safety_score?: number | null
          content_depth_score?: number | null
          cover_score?: number | null
          created_at?: string
          ebook_id?: string | null
          final_quality_score?: number | null
          hard_sell_strength_score?: number | null
          id?: string
          idea_id?: string | null
          metadata?: Json
          passed?: boolean | null
          pdf_layout_score?: number | null
          premium_score?: number | null
          raw_report?: Json
          stage: Database["public"]["Enums"]["pipeline_status"]
          updated_at?: string
        }
        Update: {
          buyer_appeal_score?: number | null
          chapter_id?: string | null
          compliance_safety_score?: number | null
          content_depth_score?: number | null
          cover_score?: number | null
          created_at?: string
          ebook_id?: string | null
          final_quality_score?: number | null
          hard_sell_strength_score?: number | null
          id?: string
          idea_id?: string | null
          metadata?: Json
          passed?: boolean | null
          pdf_layout_score?: number | null
          premium_score?: number | null
          raw_report?: Json
          stage?: Database["public"]["Enums"]["pipeline_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "qc_reports_chapter_id_fkey"
            columns: ["chapter_id"]
            isOneToOne: false
            referencedRelation: "ebook_chapters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qc_reports_ebook_id_fkey"
            columns: ["ebook_id"]
            isOneToOne: false
            referencedRelation: "ebooks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qc_reports_idea_id_fkey"
            columns: ["idea_id"]
            isOneToOne: false
            referencedRelation: "ebook_ideas"
            referencedColumns: ["id"]
          },
        ]
      }
      qc_rule_versions: {
        Row: {
          category: string
          created_at: string
          description: string | null
          id: string
          rule_id: string
          severity: string
          threshold: Json
          updated_at: string
          version: string
        }
        Insert: {
          category: string
          created_at?: string
          description?: string | null
          id?: string
          rule_id: string
          severity: string
          threshold?: Json
          updated_at?: string
          version: string
        }
        Update: {
          category?: string
          created_at?: string
          description?: string | null
          id?: string
          rule_id?: string
          severity?: string
          threshold?: Json
          updated_at?: string
          version?: string
        }
        Relationships: []
      }
      rights_holdings: {
        Row: {
          avg_cost_per_share: number
          book_id: string
          shares: number
          updated_at: string
          user_id: string
        }
        Insert: {
          avg_cost_per_share?: number
          book_id: string
          shares?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          avg_cost_per_share?: number
          book_id?: string
          shares?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rights_holdings_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "rights_offerings"
            referencedColumns: ["book_id"]
          },
        ]
      }
      rights_offerings: {
        Row: {
          book_id: string
          book_type: string
          cover_url: string | null
          last_trade_at: string | null
          last_trade_price: number | null
          listed_at: string
          ref_price_per_share: number
          title: string
          total_shares: number
          trailing_90d_net_rev: number
          treasury_shares: number
          updated_at: string
          volume_24h_usd: number
        }
        Insert: {
          book_id: string
          book_type: string
          cover_url?: string | null
          last_trade_at?: string | null
          last_trade_price?: number | null
          listed_at?: string
          ref_price_per_share?: number
          title: string
          total_shares?: number
          trailing_90d_net_rev?: number
          treasury_shares?: number
          updated_at?: string
          volume_24h_usd?: number
        }
        Update: {
          book_id?: string
          book_type?: string
          cover_url?: string | null
          last_trade_at?: string | null
          last_trade_price?: number | null
          listed_at?: string
          ref_price_per_share?: number
          title?: string
          total_shares?: number
          trailing_90d_net_rev?: number
          treasury_shares?: number
          updated_at?: string
          volume_24h_usd?: number
        }
        Relationships: []
      }
      rights_orders: {
        Row: {
          book_id: string
          created_at: string
          id: string
          is_treasury: boolean
          price_per_share: number
          qty_remaining: number
          qty_total: number
          seller_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          book_id: string
          created_at?: string
          id?: string
          is_treasury?: boolean
          price_per_share: number
          qty_remaining: number
          qty_total: number
          seller_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          book_id?: string
          created_at?: string
          id?: string
          is_treasury?: boolean
          price_per_share?: number
          qty_remaining?: number
          qty_total?: number
          seller_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rights_orders_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "rights_offerings"
            referencedColumns: ["book_id"]
          },
        ]
      }
      rights_price_history: {
        Row: {
          book_id: string
          id: string
          last_trade_price: number | null
          ref_price: number
          snapshot_at: string
          source: string
          volume_usd: number
        }
        Insert: {
          book_id: string
          id?: string
          last_trade_price?: number | null
          ref_price: number
          snapshot_at?: string
          source?: string
          volume_usd?: number
        }
        Update: {
          book_id?: string
          id?: string
          last_trade_price?: number | null
          ref_price?: number
          snapshot_at?: string
          source?: string
          volume_usd?: number
        }
        Relationships: [
          {
            foreignKeyName: "rights_price_history_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "rights_offerings"
            referencedColumns: ["book_id"]
          },
        ]
      }
      rights_trades: {
        Row: {
          book_id: string
          buyer_id: string
          executed_at: string
          gross_usd: number
          id: string
          order_id: string | null
          price_per_share: number
          qty: number
          seller_id: string | null
          seller_is_treasury: boolean
        }
        Insert: {
          book_id: string
          buyer_id: string
          executed_at?: string
          gross_usd: number
          id?: string
          order_id?: string | null
          price_per_share: number
          qty: number
          seller_id?: string | null
          seller_is_treasury?: boolean
        }
        Update: {
          book_id?: string
          buyer_id?: string
          executed_at?: string
          gross_usd?: number
          id?: string
          order_id?: string | null
          price_per_share?: number
          qty?: number
          seller_id?: string | null
          seller_is_treasury?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "rights_trades_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "rights_offerings"
            referencedColumns: ["book_id"]
          },
          {
            foreignKeyName: "rights_trades_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "rights_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      royalty_distributions: {
        Row: {
          amount_usd: number
          book_id: string
          created_at: string
          holder_id: string | null
          holder_is_treasury: boolean
          id: string
          sale_ref: string
          shares_at_snapshot: number
        }
        Insert: {
          amount_usd: number
          book_id: string
          created_at?: string
          holder_id?: string | null
          holder_is_treasury?: boolean
          id?: string
          sale_ref: string
          shares_at_snapshot: number
        }
        Update: {
          amount_usd?: number
          book_id?: string
          created_at?: string
          holder_id?: string | null
          holder_is_treasury?: boolean
          id?: string
          sale_ref?: string
          shares_at_snapshot?: number
        }
        Relationships: [
          {
            foreignKeyName: "royalty_distributions_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "rights_offerings"
            referencedColumns: ["book_id"]
          },
        ]
      }
      royalty_earnings_ledger: {
        Row: {
          book_id: string
          created_at: string
          distributable_royalty_pool_usd: number
          holding_id: string | null
          id: string
          ownership_percentage_at_sale: number
          royalty_earned_usd: number
          sale_ledger_id: string
          status: Database["public"]["Enums"]["royalty_earning_status"]
          units_owned_at_sale: number
          user_id: string
        }
        Insert: {
          book_id: string
          created_at?: string
          distributable_royalty_pool_usd: number
          holding_id?: string | null
          id?: string
          ownership_percentage_at_sale: number
          royalty_earned_usd: number
          sale_ledger_id: string
          status?: Database["public"]["Enums"]["royalty_earning_status"]
          units_owned_at_sale: number
          user_id: string
        }
        Update: {
          book_id?: string
          created_at?: string
          distributable_royalty_pool_usd?: number
          holding_id?: string | null
          id?: string
          ownership_percentage_at_sale?: number
          royalty_earned_usd?: number
          sale_ledger_id?: string
          status?: Database["public"]["Enums"]["royalty_earning_status"]
          units_owned_at_sale?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "royalty_earnings_ledger_sale_ledger_id_fkey"
            columns: ["sale_ledger_id"]
            isOneToOne: false
            referencedRelation: "book_sales_ledger"
            referencedColumns: ["id"]
          },
        ]
      }
      royalty_holdings: {
        Row: {
          average_unit_cost: number
          book_id: string
          created_at: string
          id: string
          lifetime_royalty_earned: number
          ownership_percentage: number
          pending_royalty: number
          subtotal_invested_usd: number
          total_gateway_fee_usd: number
          total_paid_usd: number
          total_vat_usd: number
          units_owned: number
          updated_at: string
          user_id: string
        }
        Insert: {
          average_unit_cost?: number
          book_id: string
          created_at?: string
          id?: string
          lifetime_royalty_earned?: number
          ownership_percentage?: number
          pending_royalty?: number
          subtotal_invested_usd?: number
          total_gateway_fee_usd?: number
          total_paid_usd?: number
          total_vat_usd?: number
          units_owned?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          average_unit_cost?: number
          book_id?: string
          created_at?: string
          id?: string
          lifetime_royalty_earned?: number
          ownership_percentage?: number
          pending_royalty?: number
          subtotal_invested_usd?: number
          total_gateway_fee_usd?: number
          total_paid_usd?: number
          total_vat_usd?: number
          units_owned?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      royalty_purchase_quotes: {
        Row: {
          book_id: string
          created_at: string
          estimated_break_even_sales_subtotal: number
          estimated_break_even_sales_total: number
          estimated_royalty_per_sale: number
          expires_at: string
          gateway_fee_usd: number
          id: string
          ownership_percentage: number
          requested_usd: number | null
          status: Database["public"]["Enums"]["royalty_quote_status"]
          subtotal_usd: number
          total_payment_usd: number
          unit_price: number
          units: number
          updated_at: string
          user_id: string
          vat_usd: number
        }
        Insert: {
          book_id: string
          created_at?: string
          estimated_break_even_sales_subtotal: number
          estimated_break_even_sales_total: number
          estimated_royalty_per_sale: number
          expires_at?: string
          gateway_fee_usd: number
          id?: string
          ownership_percentage: number
          requested_usd?: number | null
          status?: Database["public"]["Enums"]["royalty_quote_status"]
          subtotal_usd: number
          total_payment_usd: number
          unit_price: number
          units: number
          updated_at?: string
          user_id: string
          vat_usd: number
        }
        Update: {
          book_id?: string
          created_at?: string
          estimated_break_even_sales_subtotal?: number
          estimated_break_even_sales_total?: number
          estimated_royalty_per_sale?: number
          expires_at?: string
          gateway_fee_usd?: number
          id?: string
          ownership_percentage?: number
          requested_usd?: number | null
          status?: Database["public"]["Enums"]["royalty_quote_status"]
          subtotal_usd?: number
          total_payment_usd?: number
          unit_price?: number
          units?: number
          updated_at?: string
          user_id?: string
          vat_usd?: number
        }
        Relationships: []
      }
      run_skill_usage: {
        Row: {
          book_id: string | null
          created_at: string
          details: Json
          id: string
          input_reference_ids: Json
          loaded_at: string
          output_asset_ids: Json
          pass_fail_result: string
          run_id: string | null
          skill_key: string
          skill_version: string
          stage: string
        }
        Insert: {
          book_id?: string | null
          created_at?: string
          details?: Json
          id?: string
          input_reference_ids?: Json
          loaded_at?: string
          output_asset_ids?: Json
          pass_fail_result?: string
          run_id?: string | null
          skill_key: string
          skill_version: string
          stage: string
        }
        Update: {
          book_id?: string | null
          created_at?: string
          details?: Json
          id?: string
          input_reference_ids?: Json
          loaded_at?: string
          output_asset_ids?: Json
          pass_fail_result?: string
          run_id?: string | null
          skill_key?: string
          skill_version?: string
          stage?: string
        }
        Relationships: []
      }
      runtime_skill_contracts: {
        Row: {
          created_at: string
          enabled: boolean
          id: string
          prompt_contract: Json
          qc_requirements: Json
          reference_schema: Json
          required_predecessor_skills: string[]
          skill_key: string
          skill_version: string
          supported_book_types: string[]
          supported_pipeline_stages: string[]
          trigger_tags: string[]
          updated_at: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          id?: string
          prompt_contract?: Json
          qc_requirements?: Json
          reference_schema?: Json
          required_predecessor_skills?: string[]
          skill_key: string
          skill_version: string
          supported_book_types?: string[]
          supported_pipeline_stages?: string[]
          trigger_tags?: string[]
          updated_at?: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          id?: string
          prompt_contract?: Json
          qc_requirements?: Json
          reference_schema?: Json
          required_predecessor_skills?: string[]
          skill_key?: string
          skill_version?: string
          supported_book_types?: string[]
          supported_pipeline_stages?: string[]
          trigger_tags?: string[]
          updated_at?: string
        }
        Relationships: []
      }
      system_fix_instructions: {
        Row: {
          acceptance_test: string | null
          affected_ebook_id: string | null
          affected_files: Json
          affected_run_id: string | null
          created_at: string
          detected_problem: string
          error_type: string
          fingerprint: string | null
          first_seen_at: string
          id: string
          last_seen_at: string
          lovable_prompt: string
          occurrences: number
          required_fix: string
          resolved_at: string | null
          root_cause: string | null
          severity: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          acceptance_test?: string | null
          affected_ebook_id?: string | null
          affected_files?: Json
          affected_run_id?: string | null
          created_at?: string
          detected_problem: string
          error_type: string
          fingerprint?: string | null
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          lovable_prompt: string
          occurrences?: number
          required_fix: string
          resolved_at?: string | null
          root_cause?: string | null
          severity?: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          acceptance_test?: string | null
          affected_ebook_id?: string | null
          affected_files?: Json
          affected_run_id?: string | null
          created_at?: string
          detected_problem?: string
          error_type?: string
          fingerprint?: string | null
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          lovable_prompt?: string
          occurrences?: number
          required_fix?: string
          resolved_at?: string | null
          root_cause?: string | null
          severity?: string
          status?: string
          title?: string
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
      wallet_transactions: {
        Row: {
          amount_usd: number
          balance_after: number | null
          created_at: string
          id: string
          meta: Json
          ref_id: string | null
          type: string
          user_id: string
        }
        Insert: {
          amount_usd: number
          balance_after?: number | null
          created_at?: string
          id?: string
          meta?: Json
          ref_id?: string | null
          type: string
          user_id: string
        }
        Update: {
          amount_usd?: number
          balance_after?: number | null
          created_at?: string
          id?: string
          meta?: Json
          ref_id?: string | null
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      wallets: {
        Row: {
          created_at: string
          is_demo: boolean
          updated_at: string
          usd_balance: number
          user_id: string
        }
        Insert: {
          created_at?: string
          is_demo?: boolean
          updated_at?: string
          usd_balance?: number
          user_id: string
        }
        Update: {
          created_at?: string
          is_demo?: boolean
          updated_at?: string
          usd_balance?: number
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      ebook_costs: {
        Row: {
          ebook_id: string | null
          image_usd: number | null
          last_call_at: string | null
          n_calls: number | null
          n_images: number | null
          text_usd: number | null
          total_usd: number | null
        }
        Relationships: []
      }
      product_review_stats: {
        Row: {
          average_rating: number | null
          ebook_id: string | null
          review_count: number | null
        }
        Relationships: [
          {
            foreignKeyName: "product_reviews_ebook_id_fkey"
            columns: ["ebook_id"]
            isOneToOne: false
            referencedRelation: "ebooks"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      exchange_buy_amount: {
        Args: {
          p_amount_gross: number
          p_book: string
          p_buyer: string
          p_fee_pct: number
          p_tax_pct: number
        }
        Returns: Json
      }
      exchange_execute_buy: {
        Args: {
          p_book: string
          p_buyer: string
          p_max_cost: number
          p_qty: number
        }
        Returns: Json
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      kids_cycle_stats: {
        Args: { p_days?: number }
        Returns: {
          max_min: number
          min_min: number
          n_live: number
          n_sla_breach: number
          p50_min: number
          p90_min: number
        }[]
      }
      release_lock: {
        Args: { p_holder: string; p_name: string }
        Returns: boolean
      }
      try_acquire_lock: {
        Args: {
          p_holder: string
          p_name: string
          p_run_id?: string
          p_ttl_sec?: number
        }
        Returns: {
          acquired: boolean
          expires_at: string
          holder: string
        }[]
      }
    }
    Enums: {
      app_role: "admin"
      generation_mode: "low_cost" | "premium" | "hybrid"
      job_status: "queued" | "running" | "done" | "failed"
      kids_book_type: "picture_book" | "coloring_book"
      pipeline_status:
        | "ideation"
        | "idea_generated"
        | "title_copywriting"
        | "outline_generation"
        | "writing"
        | "chapter_qc"
        | "pdf_design"
        | "cover_design"
        | "product_copy"
        | "final_qc"
        | "published"
        | "rejected"
      royalty_earning_status: "recorded" | "paid" | "reversed"
      royalty_market_status: "active" | "paused" | "closed"
      royalty_quote_status:
        | "draft"
        | "quoted"
        | "awaiting_payment"
        | "reserved"
        | "simulated_completed"
        | "cancelled"
        | "expired"
      royalty_sale_status: "recorded" | "refunded" | "charged_back"
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
      kids_book_type: ["picture_book", "coloring_book"],
      pipeline_status: [
        "ideation",
        "idea_generated",
        "title_copywriting",
        "outline_generation",
        "writing",
        "chapter_qc",
        "pdf_design",
        "cover_design",
        "product_copy",
        "final_qc",
        "published",
        "rejected",
      ],
      royalty_earning_status: ["recorded", "paid", "reversed"],
      royalty_market_status: ["active", "paused", "closed"],
      royalty_quote_status: [
        "draft",
        "quoted",
        "awaiting_payment",
        "reserved",
        "simulated_completed",
        "cancelled",
        "expired",
      ],
      royalty_sale_status: ["recorded", "refunded", "charged_back"],
    },
  },
} as const
