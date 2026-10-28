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
      forum_comments: {
        Row: {
          author_name: string
          avatar_url: string | null
          body: string
          created_at: string
          edit_token: string
          id: string
          thread_id: string
          updated_at: string
        }
        Insert: {
          author_name?: string
          avatar_url?: string | null
          body: string
          created_at?: string
          edit_token: string
          id?: string
          thread_id: string
          updated_at?: string
        }
        Update: {
          author_name?: string
          avatar_url?: string | null
          body?: string
          created_at?: string
          edit_token?: string
          id?: string
          thread_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "forum_comments_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "forum_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      forum_threads: {
        Row: {
          author_name: string
          avatar_url: string | null
          body: string
          category: Database["public"]["Enums"]["forum_category"]
          comment_count: number
          created_at: string
          edit_token: string
          id: string
          is_pinned: boolean
          title: string
          updated_at: string
        }
        Insert: {
          author_name?: string
          avatar_url?: string | null
          body?: string
          category?: Database["public"]["Enums"]["forum_category"]
          comment_count?: number
          created_at?: string
          edit_token: string
          id?: string
          is_pinned?: boolean
          title: string
          updated_at?: string
        }
        Update: {
          author_name?: string
          avatar_url?: string | null
          body?: string
          category?: Database["public"]["Enums"]["forum_category"]
          comment_count?: number
          created_at?: string
          edit_token?: string
          id?: string
          is_pinned?: boolean
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      novel_marks: {
        Row: {
          created_at: string
          edit_token: string
          id: string
          mark: string
          novel_id: string
          updated_at: string
          user_name: string
        }
        Insert: {
          created_at?: string
          edit_token: string
          id?: string
          mark: string
          novel_id: string
          updated_at?: string
          user_name: string
        }
        Update: {
          created_at?: string
          edit_token?: string
          id?: string
          mark?: string
          novel_id?: string
          updated_at?: string
          user_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "novel_marks_novel_id_fkey"
            columns: ["novel_id"]
            isOneToOne: false
            referencedRelation: "ranked_novels"
            referencedColumns: ["id"]
          },
        ]
      }
      ranked_novels: {
        Row: {
          added_by: string
          author: string | null
          category: string
          created_at: string
          edit_token: string
          id: string
          title: string
        }
        Insert: {
          added_by: string
          author?: string | null
          category?: string
          created_at?: string
          edit_token: string
          id?: string
          title: string
        }
        Update: {
          added_by?: string
          author?: string | null
          category?: string
          created_at?: string
          edit_token?: string
          id?: string
          title?: string
        }
        Relationships: []
      }
      site_health: {
        Row: {
          checked_at: string
          created_at: string
          host: string
          note: string | null
          status: string
          updated_at: string
        }
        Insert: {
          checked_at?: string
          created_at?: string
          host: string
          note?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          checked_at?: string
          created_at?: string
          host?: string
          note?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      delete_forum_comment: {
        Args: { p_admin?: string; p_id: string; p_token: string }
        Returns: boolean
      }
      delete_forum_thread: {
        Args: { p_admin?: string; p_id: string; p_token: string }
        Returns: boolean
      }
      is_forum_admin: { Args: { p_admin: string }; Returns: boolean }
      remove_novel_mark: {
        Args: { p_novel_id: string; p_token: string; p_user_name: string }
        Returns: boolean
      }
      set_novel_mark: {
        Args: {
          p_mark: string
          p_novel_id: string
          p_token: string
          p_user_name: string
        }
        Returns: {
          created_at: string
          edit_token: string
          id: string
          mark: string
          novel_id: string
          updated_at: string
          user_name: string
        }
        SetofOptions: {
          from: "*"
          to: "novel_marks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_forum_comment: {
        Args: {
          p_admin?: string
          p_body: string
          p_id: string
          p_token: string
        }
        Returns: {
          author_name: string
          avatar_url: string | null
          body: string
          created_at: string
          edit_token: string
          id: string
          thread_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "forum_comments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_forum_thread: {
        Args: {
          p_admin?: string
          p_body: string
          p_category: Database["public"]["Enums"]["forum_category"]
          p_id: string
          p_title: string
          p_token: string
        }
        Returns: {
          author_name: string
          avatar_url: string | null
          body: string
          category: Database["public"]["Enums"]["forum_category"]
          comment_count: number
          created_at: string
          edit_token: string
          id: string
          is_pinned: boolean
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "forum_threads"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      forum_category: "report_error" | "new_site" | "general" | "book_request"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      forum_category: ["report_error", "new_site", "general", "book_request"],
    },
  },
} as const
