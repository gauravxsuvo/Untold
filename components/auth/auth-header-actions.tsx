import { InstallAppButton } from "@/components/pwa/install-app-button";
import { ThemeSwitcher } from "@/components/theme/theme-switcher";

export function AuthHeaderActions() {
  return (
    <div className="auth-header-actions">
      <InstallAppButton />
      <ThemeSwitcher compact />
    </div>
  );
}
