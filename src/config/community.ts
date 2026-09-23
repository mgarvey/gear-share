const configuredCommunityName = import.meta.env.VITE_COMMUNITY_NAME?.trim();
const configuredCommunityLogoUrl = import.meta.env.VITE_COMMUNITY_LOGO_URL?.trim();

export const communityName = configuredCommunityName || "Community";
export const gearShareName = `${communityName} Gear Share`;
export const communityLogoUrl = configuredCommunityLogoUrl || "/favicon.png";
