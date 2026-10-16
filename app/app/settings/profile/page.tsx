import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ProfilePreview } from "@/components/auth/profile-preview";
export default function SettingsProfilePage() {
  return (
    <>
      <Link className="settings-profile-back" href="/app/settings">
        <ArrowLeft size={16} />
        Back to Settings
      </Link>
      <ProfilePreview />
    </>
  );
}
