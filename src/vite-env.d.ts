/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_COMMUNITY_NAME?: string;
  readonly VITE_COMMUNITY_LOGO_URL?: string;
  readonly VITE_PRIVACY_CONTACT_URL: string;
  readonly VITE_BACKUP_RETENTION_DAYS: string;
}
