import { Navigate, useLocation } from "react-router-dom";
import type { AccessLevel } from "@/types/gear";

export function LegacyManagementRedirect({ accessLevel }: { accessLevel: AccessLevel }) {
  const location = useLocation();
  if (accessLevel === "regular") return <Navigate to="/catalog" replace />;
  const params = new URLSearchParams(location.search);
  const membersRequested = accessLevel === "administrator" && params.get("view") === "members";
  params.delete("view");
  const search = params.toString();
  const pathname = membersRequested ? "/administration" : "/inventory";
  return <Navigate to={`${pathname}${search ? `?${search}` : ""}`} replace />;
}
