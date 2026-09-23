export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      communities: {
        Row: {
          created_at: string
          id: string
          join_mode: Database["public"]["Enums"]["community_join_mode"]
          name: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          join_mode?: Database["public"]["Enums"]["community_join_mode"]
          name: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          join_mode?: Database["public"]["Enums"]["community_join_mode"]
          name?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      community_roles: {
        Row: {
          community_id: string
          granted_at: string
          granted_by: string | null
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          community_id: string
          granted_at?: string
          granted_by?: string | null
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          community_id?: string
          granted_at?: string
          granted_by?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_roles_community_id_fkey"
            columns: ["community_id"]
            isOneToOne: false
            referencedRelation: "communities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_roles_member_same_community_fkey"
            columns: ["community_id", "user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["community_id", "id"]
          },
          {
            foreignKeyName: "community_roles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      founding_steward_bootstrap: {
        Row: {
          bootstrapped_at: string
          community_id: string
          operator_identifier: string
          reason: string
          user_id: string
        }
        Insert: {
          bootstrapped_at?: string
          community_id: string
          operator_identifier: string
          reason: string
          user_id: string
        }
        Update: {
          bootstrapped_at?: string
          community_id?: string
          operator_identifier?: string
          reason?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "founding_steward_bootstrap_community_id_fkey"
            columns: ["community_id"]
            isOneToOne: true
            referencedRelation: "communities"
            referencedColumns: ["id"]
          },
        ]
      }
      gear_loans: {
        Row: {
          borrower_id: string
          borrower_note: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          checked_out_at: string | null
          checked_out_by: string | null
          community_id: string
          created_at: string
          custodian_at_request_id: string
          decided_at: string | null
          decided_by: string | null
          end_date: string
          id: string
          quantity: number
          returned_at: string | null
          returned_by: string | null
          start_date: string
          status: Database["public"]["Enums"]["gear_loan_status"]
          supply_id: string
          updated_at: string
        }
        Insert: {
          borrower_id: string
          borrower_note?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          checked_out_at?: string | null
          checked_out_by?: string | null
          community_id: string
          created_at?: string
          custodian_at_request_id: string
          decided_at?: string | null
          decided_by?: string | null
          end_date: string
          id?: string
          quantity: number
          returned_at?: string | null
          returned_by?: string | null
          start_date: string
          status?: Database["public"]["Enums"]["gear_loan_status"]
          supply_id: string
          updated_at?: string
        }
        Update: {
          borrower_id?: string
          borrower_note?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          checked_out_at?: string | null
          checked_out_by?: string | null
          community_id?: string
          created_at?: string
          custodian_at_request_id?: string
          decided_at?: string | null
          decided_by?: string | null
          end_date?: string
          id?: string
          quantity?: number
          returned_at?: string | null
          returned_by?: string | null
          start_date?: string
          status?: Database["public"]["Enums"]["gear_loan_status"]
          supply_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "gear_loans_borrower_id_fkey"
            columns: ["borrower_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gear_loans_borrower_same_community_fkey"
            columns: ["community_id", "borrower_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["community_id", "id"]
          },
          {
            foreignKeyName: "gear_loans_community_id_fkey"
            columns: ["community_id"]
            isOneToOne: false
            referencedRelation: "communities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gear_loans_custodian_at_request_id_fkey"
            columns: ["custodian_at_request_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gear_loans_request_custodian_same_community_fkey"
            columns: ["community_id", "custodian_at_request_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["community_id", "id"]
          },
          {
            foreignKeyName: "gear_loans_supply_id_fkey"
            columns: ["supply_id"]
            isOneToOne: false
            referencedRelation: "supplies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gear_loans_supply_same_community_fkey"
            columns: ["community_id", "supply_id"]
            isOneToOne: false
            referencedRelation: "supplies"
            referencedColumns: ["community_id", "id"]
          },
        ]
      }
      member_postal_codes: {
        Row: {
          community_id: string
          postal_code: string
          profile_id: string
          updated_at: string
        }
        Insert: {
          community_id: string
          postal_code: string
          profile_id: string
          updated_at?: string
        }
        Update: {
          community_id?: string
          postal_code?: string
          profile_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_postal_profile_same_community_fkey"
            columns: ["community_id", "profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["community_id", "id"]
          },
        ]
      }
      profiles: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          community_id: string
          created_at: string
          deactivated_at: string | null
          deactivated_by: string | null
          display_name: string
          id: string
          membership_status: Database["public"]["Enums"]["membership_status"]
          rejected_at: string | null
          rejected_by: string | null
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          community_id: string
          created_at?: string
          deactivated_at?: string | null
          deactivated_by?: string | null
          display_name: string
          id: string
          membership_status?: Database["public"]["Enums"]["membership_status"]
          rejected_at?: string | null
          rejected_by?: string | null
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          community_id?: string
          created_at?: string
          deactivated_at?: string | null
          deactivated_by?: string | null
          display_name?: string
          id?: string
          membership_status?: Database["public"]["Enums"]["membership_status"]
          rejected_at?: string | null
          rejected_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_community_id_fkey"
            columns: ["community_id"]
            isOneToOne: false
            referencedRelation: "communities"
            referencedColumns: ["id"]
          },
        ]
      }
      role_audit: {
        Row: {
          action: string
          actor_user_id: string | null
          community_id: string
          id: number
          occurred_at: string
          operator_identifier: string | null
          reason: string | null
          role: Database["public"]["Enums"]["app_role"]
          target_user_id: string
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          community_id: string
          id?: never
          occurred_at?: string
          operator_identifier?: string | null
          reason?: string | null
          role: Database["public"]["Enums"]["app_role"]
          target_user_id: string
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          community_id?: string
          id?: never
          occurred_at?: string
          operator_identifier?: string | null
          reason?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          target_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_audit_community_id_fkey"
            columns: ["community_id"]
            isOneToOne: false
            referencedRelation: "communities"
            referencedColumns: ["id"]
          },
        ]
      }
      supplies: {
        Row: {
          category: string | null
          community_id: string
          condition: string | null
          created_at: string
          created_by: string
          custodian_id: string
          description: string
          id: string
          image_paths: string[]
          listing_status: Database["public"]["Enums"]["listing_status"]
          owner_id: string | null
          ownership_kind: Database["public"]["Enums"]["ownership_kind"]
          quantity_total: number
          retired_at: string | null
          title: string
          updated_at: string
        }
        Insert: {
          category?: string | null
          community_id: string
          condition?: string | null
          created_at?: string
          created_by: string
          custodian_id: string
          description?: string
          id?: string
          image_paths?: string[]
          listing_status?: Database["public"]["Enums"]["listing_status"]
          owner_id?: string | null
          ownership_kind: Database["public"]["Enums"]["ownership_kind"]
          quantity_total: number
          retired_at?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          category?: string | null
          community_id?: string
          condition?: string | null
          created_at?: string
          created_by?: string
          custodian_id?: string
          description?: string
          id?: string
          image_paths?: string[]
          listing_status?: Database["public"]["Enums"]["listing_status"]
          owner_id?: string | null
          ownership_kind?: Database["public"]["Enums"]["ownership_kind"]
          quantity_total?: number
          retired_at?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplies_community_id_fkey"
            columns: ["community_id"]
            isOneToOne: false
            referencedRelation: "communities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplies_custodian_id_fkey"
            columns: ["custodian_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplies_custodian_same_community_fkey"
            columns: ["community_id", "custodian_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["community_id", "id"]
          },
          {
            foreignKeyName: "supplies_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplies_owner_same_community_fkey"
            columns: ["community_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["community_id", "id"]
          },
        ]
      }
      supply_condition_history: {
        Row: {
          changed_at: string
          changed_by: string
          community_id: string
          id: number
          next_condition: string
          prior_condition: string | null
          supply_id: string
        }
        Insert: {
          changed_at?: string
          changed_by: string
          community_id: string
          id?: never
          next_condition: string
          prior_condition?: string | null
          supply_id: string
        }
        Update: {
          changed_at?: string
          changed_by?: string
          community_id?: string
          id?: never
          next_condition?: string
          prior_condition?: string | null
          supply_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "supply_condition_supply_same_community_fkey"
            columns: ["community_id", "supply_id"]
            isOneToOne: false
            referencedRelation: "supplies"
            referencedColumns: ["community_id", "id"]
          },
        ]
      }
      supply_donation_audit: {
        Row: {
          community_id: string
          converted_at: string
          converted_by: string
          prior_owner_id: string
          supply_id: string
        }
        Insert: {
          community_id: string
          converted_at?: string
          converted_by: string
          prior_owner_id: string
          supply_id: string
        }
        Update: {
          community_id?: string
          converted_at?: string
          converted_by?: string
          prior_owner_id?: string
          supply_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "supply_donation_audit_community_id_fkey"
            columns: ["community_id"]
            isOneToOne: false
            referencedRelation: "communities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supply_donation_audit_supply_id_fkey"
            columns: ["supply_id"]
            isOneToOne: true
            referencedRelation: "supplies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supply_donation_supply_same_community_fkey"
            columns: ["community_id", "supply_id"]
            isOneToOne: false
            referencedRelation: "supplies"
            referencedColumns: ["community_id", "id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      approve_gear_loan: {
        Args: { target_loan_id: string }
        Returns: {
          borrower_id: string
          borrower_note: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          checked_out_at: string | null
          checked_out_by: string | null
          community_id: string
          created_at: string
          custodian_at_request_id: string
          decided_at: string | null
          decided_by: string | null
          end_date: string
          id: string
          quantity: number
          returned_at: string | null
          returned_by: string | null
          start_date: string
          status: Database["public"]["Enums"]["gear_loan_status"]
          supply_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "gear_loans"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      available_quantity: {
        Args: {
          range_end: string
          range_start: string
          target_supply_id: string
        }
        Returns: number
      }
      bootstrap_founding_steward: {
        Args: {
          supplied_operator_identifier: string
          supplied_reason: string
          target_user_id: string
        }
        Returns: undefined
      }
      can_manage_gear_object: {
        Args: { object_name: string }
        Returns: boolean
      }
      can_view_gear_object: { Args: { object_name: string }; Returns: boolean }
      cancel_gear_loan: {
        Args: { supplied_reason?: string; target_loan_id: string }
        Returns: {
          borrower_id: string
          borrower_note: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          checked_out_at: string | null
          checked_out_by: string | null
          community_id: string
          created_at: string
          custodian_at_request_id: string
          decided_at: string | null
          decided_by: string | null
          end_date: string
          id: string
          quantity: number
          returned_at: string | null
          returned_by: string | null
          start_date: string
          status: Database["public"]["Enums"]["gear_loan_status"]
          supply_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "gear_loans"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      checkout_gear_loan: {
        Args: { target_loan_id: string }
        Returns: {
          borrower_id: string
          borrower_note: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          checked_out_at: string | null
          checked_out_by: string | null
          community_id: string
          created_at: string
          custodian_at_request_id: string
          decided_at: string | null
          decided_by: string | null
          end_date: string
          id: string
          quantity: number
          returned_at: string | null
          returned_by: string | null
          start_date: string
          status: Database["public"]["Enums"]["gear_loan_status"]
          supply_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "gear_loans"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      convert_individual_donation: {
        Args: { new_custodian_id: string; target_supply_id: string }
        Returns: {
          category: string | null
          community_id: string
          condition: string | null
          created_at: string
          created_by: string
          custodian_id: string
          description: string
          id: string
          image_paths: string[]
          listing_status: Database["public"]["Enums"]["listing_status"]
          owner_id: string | null
          ownership_kind: Database["public"]["Enums"]["ownership_kind"]
          quantity_total: number
          retired_at: string | null
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "supplies"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_group_supply: {
        Args: {
          supplied_category: string
          supplied_condition: string
          supplied_custodian_id: string
          supplied_description: string
          supplied_quantity: number
          supplied_status: Database["public"]["Enums"]["listing_status"]
          supplied_title: string
        }
        Returns: {
          category: string | null
          community_id: string
          condition: string | null
          created_at: string
          created_by: string
          custodian_id: string
          description: string
          id: string
          image_paths: string[]
          listing_status: Database["public"]["Enums"]["listing_status"]
          owner_id: string | null
          ownership_kind: Database["public"]["Enums"]["ownership_kind"]
          quantity_total: number
          retired_at: string | null
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "supplies"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_individual_supply: {
        Args: {
          supplied_category: string
          supplied_condition: string
          supplied_description: string
          supplied_quantity: number
          supplied_status: Database["public"]["Enums"]["listing_status"]
          supplied_title: string
        }
        Returns: {
          category: string | null
          community_id: string
          condition: string | null
          created_at: string
          created_by: string
          custodian_id: string
          description: string
          id: string
          image_paths: string[]
          listing_status: Database["public"]["Enums"]["listing_status"]
          owner_id: string | null
          ownership_kind: Database["public"]["Enums"]["ownership_kind"]
          quantity_total: number
          retired_at: string | null
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "supplies"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      current_access_level: {
        Args: { target_community_id: string }
        Returns: Database["public"]["Enums"]["app_role"]
      }
      current_active_community_id: { Args: never; Returns: string }
      deactivate_member: {
        Args: { successor_user_id: string; target_user_id: string }
        Returns: undefined
      }
      deactivation_impact: {
        Args: { successor_user_id: string; target_user_id: string }
        Returns: {
          affected_listings: number
          checked_out_loans: number
          requests_to_cancel: number
        }[]
      }
      decide_membership: {
        Args: { approve: boolean; target_user_id: string }
        Returns: undefined
      }
      decline_gear_loan: {
        Args: { target_loan_id: string }
        Returns: {
          borrower_id: string
          borrower_note: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          checked_out_at: string | null
          checked_out_by: string | null
          community_id: string
          created_at: string
          custodian_at_request_id: string
          decided_at: string | null
          decided_by: string | null
          end_date: string
          id: string
          quantity: number
          returned_at: string | null
          returned_by: string | null
          start_date: string
          status: Database["public"]["Enums"]["gear_loan_status"]
          supply_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "gear_loans"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      get_my_postal_code: { Args: never; Returns: string }
      is_active_administrator: {
        Args: { target_community_id: string }
        Returns: boolean
      }
      is_active_custodian: {
        Args: { target_community_id: string }
        Returns: boolean
      }
      is_active_inventory_manager: {
        Args: { target_community_id: string }
        Returns: boolean
      }
      is_active_member: {
        Args: { target_community_id: string }
        Returns: boolean
      }
      is_active_steward: {
        Args: { target_community_id: string }
        Returns: boolean
      }
      is_canonical_gear_category: { Args: { value: string }; Returns: boolean }
      is_canonical_gear_condition: { Args: { value: string }; Returns: boolean }
      loan_manager_authorized: {
        Args: {
          item: Database["public"]["Tables"]["supplies"]["Row"]
          operation: string
        }
        Returns: boolean
      }
      lock_community_authorization: {
        Args: { exclusive_lock?: boolean; target_community_id: string }
        Returns: undefined
      }
      lock_listing: { Args: { target_supply_id: string }; Returns: undefined }
      max_committed_quantity: {
        Args: {
          excluded_loan_id?: string
          range_end: string
          range_start: string
          target_supply_id: string
        }
        Returns: number
      }
      normalize_postal_code: { Args: { value: string }; Returns: string }
      private_gear_catalog: {
        Args: {
          supplied_available_only: boolean
          supplied_category: string
          supplied_condition: string
          supplied_end: string | null
          supplied_ownership: string
          supplied_page: number
          supplied_postal: string
          supplied_search: string
          supplied_start: string | null
        }
        Returns: {
          available_quantity: number | null
          category: string
          community_id: string
          condition: string
          custodian_id: string
          custodian_name: string
          custodian_postal_code: string
          description: string
          id: string
          image_paths: string[]
          listing_status: Database["public"]["Enums"]["listing_status"]
          owner_id: string
          owner_is_active: boolean
          ownership_kind: Database["public"]["Enums"]["ownership_kind"]
          quantity_total: number
          resolved_page: number
          title: string
          total_count: number
        }[]
      }
      private_listing_postal_code: {
        Args: { target_supply_id: string }
        Returns: string
      }
      reassign_group_custodian: {
        Args: { new_custodian_id: string; target_supply_id: string }
        Returns: {
          category: string | null
          community_id: string
          condition: string | null
          created_at: string
          created_by: string
          custodian_id: string
          description: string
          id: string
          image_paths: string[]
          listing_status: Database["public"]["Enums"]["listing_status"]
          owner_id: string | null
          ownership_kind: Database["public"]["Enums"]["ownership_kind"]
          quantity_total: number
          retired_at: string | null
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "supplies"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      request_gear_loan: {
        Args: {
          requested_end: string
          requested_quantity: number
          requested_start: string
          supplied_note?: string
          target_supply_id: string
        }
        Returns: {
          borrower_id: string
          borrower_note: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          checked_out_at: string | null
          checked_out_by: string | null
          community_id: string
          created_at: string
          custodian_at_request_id: string
          decided_at: string | null
          decided_by: string | null
          end_date: string
          id: string
          quantity: number
          returned_at: string | null
          returned_by: string | null
          start_date: string
          status: Database["public"]["Enums"]["gear_loan_status"]
          supply_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "gear_loans"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      retire_supply: {
        Args: { target_supply_id: string }
        Returns: {
          category: string | null
          community_id: string
          condition: string | null
          created_at: string
          created_by: string
          custodian_id: string
          description: string
          id: string
          image_paths: string[]
          listing_status: Database["public"]["Enums"]["listing_status"]
          owner_id: string | null
          ownership_kind: Database["public"]["Enums"]["ownership_kind"]
          quantity_total: number
          retired_at: string | null
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "supplies"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      return_gear_loan: {
        Args: { target_loan_id: string }
        Returns: {
          borrower_id: string
          borrower_note: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          checked_out_at: string | null
          checked_out_by: string | null
          community_id: string
          created_at: string
          custodian_at_request_id: string
          decided_at: string | null
          decided_by: string | null
          end_date: string
          id: string
          quantity: number
          returned_at: string | null
          returned_by: string | null
          start_date: string
          status: Database["public"]["Enums"]["gear_loan_status"]
          supply_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "gear_loans"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_access_level: {
        Args: {
          target_role: Database["public"]["Enums"]["app_role"]
          target_user_id: string
        }
        Returns: undefined
      }
      set_my_postal_code: { Args: { supplied_postal: string }; Returns: string }
      set_steward: {
        Args: { make_steward: boolean; target_user_id: string }
        Returns: undefined
      }
      set_supply_contact: {
        Args: { new_contact_id: string; target_supply_id: string }
        Returns: {
          category: string | null
          community_id: string
          condition: string | null
          created_at: string
          created_by: string
          custodian_id: string
          description: string
          id: string
          image_paths: string[]
          listing_status: Database["public"]["Enums"]["listing_status"]
          owner_id: string | null
          ownership_kind: Database["public"]["Enums"]["ownership_kind"]
          quantity_total: number
          retired_at: string | null
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "supplies"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_supply_image_paths: {
        Args: { supplied_paths: string[]; target_supply_id: string }
        Returns: {
          category: string | null
          community_id: string
          condition: string | null
          created_at: string
          created_by: string
          custodian_id: string
          description: string
          id: string
          image_paths: string[]
          listing_status: Database["public"]["Enums"]["listing_status"]
          owner_id: string | null
          ownership_kind: Database["public"]["Enums"]["ownership_kind"]
          quantity_total: number
          retired_at: string | null
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "supplies"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_supply: {
        Args: {
          supplied_category: string
          supplied_condition: string
          supplied_description: string
          supplied_quantity: number
          supplied_status: Database["public"]["Enums"]["listing_status"]
          supplied_title: string
          target_supply_id: string
        }
        Returns: {
          category: string | null
          community_id: string
          condition: string | null
          created_at: string
          created_by: string
          custodian_id: string
          description: string
          id: string
          image_paths: string[]
          listing_status: Database["public"]["Enums"]["listing_status"]
          owner_id: string | null
          ownership_kind: Database["public"]["Enums"]["ownership_kind"]
          quantity_total: number
          retired_at: string | null
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "supplies"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      app_role: "member" | "steward" | "custodian"
      community_join_mode: "approval_required"
      gear_loan_status:
        | "pending"
        | "approved"
        | "checked_out"
        | "returned"
        | "declined"
        | "cancelled"
      listing_status: "listed" | "unlisted" | "retired"
      membership_status: "pending" | "active" | "rejected" | "deactivated"
      ownership_kind: "individual" | "group"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  storage: {
    Tables: {
      buckets: {
        Row: {
          allowed_mime_types: string[] | null
          avif_autodetection: boolean | null
          created_at: string | null
          file_size_limit: number | null
          id: string
          name: string
          owner: string | null
          owner_id: string | null
          public: boolean | null
          type: Database["storage"]["Enums"]["buckettype"]
          updated_at: string | null
        }
        Insert: {
          allowed_mime_types?: string[] | null
          avif_autodetection?: boolean | null
          created_at?: string | null
          file_size_limit?: number | null
          id: string
          name: string
          owner?: string | null
          owner_id?: string | null
          public?: boolean | null
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string | null
        }
        Update: {
          allowed_mime_types?: string[] | null
          avif_autodetection?: boolean | null
          created_at?: string | null
          file_size_limit?: number | null
          id?: string
          name?: string
          owner?: string | null
          owner_id?: string | null
          public?: boolean | null
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string | null
        }
        Relationships: []
      }
      buckets_analytics: {
        Row: {
          created_at: string
          deleted_at: string | null
          format: string
          id: string
          name: string
          type: Database["storage"]["Enums"]["buckettype"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          format?: string
          id?: string
          name: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          format?: string
          id?: string
          name?: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Relationships: []
      }
      buckets_vectors: {
        Row: {
          created_at: string
          id: string
          type: Database["storage"]["Enums"]["buckettype"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          id: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Relationships: []
      }
      iceberg_namespaces: {
        Row: {
          bucket_name: string
          catalog_id: string
          created_at: string
          id: string
          metadata: Json
          name: string
          updated_at: string
        }
        Insert: {
          bucket_name: string
          catalog_id: string
          created_at?: string
          id?: string
          metadata?: Json
          name: string
          updated_at?: string
        }
        Update: {
          bucket_name?: string
          catalog_id?: string
          created_at?: string
          id?: string
          metadata?: Json
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "iceberg_namespaces_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "buckets_analytics"
            referencedColumns: ["id"]
          },
        ]
      }
      iceberg_tables: {
        Row: {
          bucket_name: string
          catalog_id: string
          created_at: string
          id: string
          location: string
          name: string
          namespace_id: string
          remote_table_id: string | null
          shard_id: string | null
          shard_key: string | null
          updated_at: string
        }
        Insert: {
          bucket_name: string
          catalog_id: string
          created_at?: string
          id?: string
          location: string
          name: string
          namespace_id: string
          remote_table_id?: string | null
          shard_id?: string | null
          shard_key?: string | null
          updated_at?: string
        }
        Update: {
          bucket_name?: string
          catalog_id?: string
          created_at?: string
          id?: string
          location?: string
          name?: string
          namespace_id?: string
          remote_table_id?: string | null
          shard_id?: string | null
          shard_key?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "iceberg_tables_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "buckets_analytics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "iceberg_tables_namespace_id_fkey"
            columns: ["namespace_id"]
            isOneToOne: false
            referencedRelation: "iceberg_namespaces"
            referencedColumns: ["id"]
          },
        ]
      }
      migrations: {
        Row: {
          executed_at: string | null
          hash: string
          id: number
          name: string
        }
        Insert: {
          executed_at?: string | null
          hash: string
          id: number
          name: string
        }
        Update: {
          executed_at?: string | null
          hash?: string
          id?: number
          name?: string
        }
        Relationships: []
      }
      objects: {
        Row: {
          bucket_id: string | null
          created_at: string | null
          id: string
          last_accessed_at: string | null
          metadata: Json | null
          name: string | null
          owner: string | null
          owner_id: string | null
          path_tokens: string[] | null
          updated_at: string | null
          user_metadata: Json | null
          version: string | null
        }
        Insert: {
          bucket_id?: string | null
          created_at?: string | null
          id?: string
          last_accessed_at?: string | null
          metadata?: Json | null
          name?: string | null
          owner?: string | null
          owner_id?: string | null
          path_tokens?: string[] | null
          updated_at?: string | null
          user_metadata?: Json | null
          version?: string | null
        }
        Update: {
          bucket_id?: string | null
          created_at?: string | null
          id?: string
          last_accessed_at?: string | null
          metadata?: Json | null
          name?: string | null
          owner?: string | null
          owner_id?: string | null
          path_tokens?: string[] | null
          updated_at?: string | null
          user_metadata?: Json | null
          version?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "objects_bucketId_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
        ]
      }
      s3_multipart_uploads: {
        Row: {
          bucket_id: string
          created_at: string
          id: string
          in_progress_size: number
          key: string
          metadata: Json | null
          owner_id: string | null
          upload_signature: string
          user_metadata: Json | null
          version: string
        }
        Insert: {
          bucket_id: string
          created_at?: string
          id: string
          in_progress_size?: number
          key: string
          metadata?: Json | null
          owner_id?: string | null
          upload_signature: string
          user_metadata?: Json | null
          version: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          id?: string
          in_progress_size?: number
          key?: string
          metadata?: Json | null
          owner_id?: string | null
          upload_signature?: string
          user_metadata?: Json | null
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "s3_multipart_uploads_bucket_id_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
        ]
      }
      s3_multipart_uploads_parts: {
        Row: {
          bucket_id: string
          created_at: string
          etag: string
          id: string
          key: string
          owner_id: string | null
          part_number: number
          size: number
          upload_id: string
          version: string
        }
        Insert: {
          bucket_id: string
          created_at?: string
          etag: string
          id?: string
          key: string
          owner_id?: string | null
          part_number: number
          size?: number
          upload_id: string
          version: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          etag?: string
          id?: string
          key?: string
          owner_id?: string | null
          part_number?: number
          size?: number
          upload_id?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "s3_multipart_uploads_parts_bucket_id_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "s3_multipart_uploads_parts_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "s3_multipart_uploads"
            referencedColumns: ["id"]
          },
        ]
      }
      vector_indexes: {
        Row: {
          bucket_id: string
          created_at: string
          data_type: string
          dimension: number
          distance_metric: string
          id: string
          metadata_configuration: Json | null
          name: string
          updated_at: string
        }
        Insert: {
          bucket_id: string
          created_at?: string
          data_type: string
          dimension: number
          distance_metric: string
          id?: string
          metadata_configuration?: Json | null
          name: string
          updated_at?: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          data_type?: string
          dimension?: number
          distance_metric?: string
          id?: string
          metadata_configuration?: Json | null
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vector_indexes_bucket_id_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets_vectors"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      allow_any_operation: {
        Args: { expected_operations: string[] }
        Returns: boolean
      }
      allow_only_operation: {
        Args: { expected_operation: string }
        Returns: boolean
      }
      can_insert_object: {
        Args: { bucketid: string; metadata: Json; name: string; owner: string }
        Returns: undefined
      }
      extension: { Args: { name: string }; Returns: string }
      filename: { Args: { name: string }; Returns: string }
      foldername: { Args: { name: string }; Returns: string[] }
      get_common_prefix: {
        Args: { p_delimiter: string; p_key: string; p_prefix: string }
        Returns: string
      }
      get_size_by_bucket: {
        Args: never
        Returns: {
          bucket_id: string
          size: number
        }[]
      }
      list_multipart_uploads_with_delimiter: {
        Args: {
          bucket_id: string
          delimiter_param: string
          max_keys?: number
          next_key_token?: string
          next_upload_token?: string
          prefix_param: string
        }
        Returns: {
          created_at: string
          id: string
          key: string
        }[]
      }
      list_objects_with_delimiter: {
        Args: {
          _bucket_id: string
          delimiter_param: string
          max_keys?: number
          next_token?: string
          prefix_param: string
          sort_order?: string
          start_after?: string
        }
        Returns: {
          created_at: string
          id: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
      operation: { Args: never; Returns: string }
      search: {
        Args: {
          bucketname: string
          levels?: number
          limits?: number
          offsets?: number
          prefix: string
          search?: string
          sortcolumn?: string
          sortorder?: string
        }
        Returns: {
          created_at: string
          id: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
      search_by_timestamp: {
        Args: {
          p_bucket_id: string
          p_level: number
          p_limit: number
          p_prefix: string
          p_sort_column: string
          p_sort_column_after: string
          p_sort_order: string
          p_start_after: string
        }
        Returns: {
          created_at: string
          id: string
          key: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
      search_v2: {
        Args: {
          bucket_name: string
          levels?: number
          limits?: number
          prefix: string
          sort_column?: string
          sort_column_after?: string
          sort_order?: string
          start_after?: string
        }
        Returns: {
          created_at: string
          id: string
          key: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
    }
    Enums: {
      buckettype: "STANDARD" | "ANALYTICS" | "VECTOR"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      app_role: ["member", "steward", "custodian"],
      community_join_mode: ["approval_required"],
      gear_loan_status: [
        "pending",
        "approved",
        "checked_out",
        "returned",
        "declined",
        "cancelled",
      ],
      listing_status: ["listed", "unlisted", "retired"],
      membership_status: ["pending", "active", "rejected", "deactivated"],
      ownership_kind: ["individual", "group"],
    },
  },
  storage: {
    Enums: {
      buckettype: ["STANDARD", "ANALYTICS", "VECTOR"],
    },
  },
} as const
