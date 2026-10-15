"use client";

import Image from "next/image";
import { useState } from "react";
import { initialsFor } from "@/lib/messaging/people";
import { safeProfilePhotoUrl } from "@/lib/profile/photos";
import { safeGroupPhotoUrl } from "@/lib/messaging/groups";

export function Avatar({
  id,
  name,
  image,
  className = "",
  group = false,
}: {
  id: string;
  name: string;
  image?: string | null;
  className?: string;
  group?: boolean;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const url = group ? safeGroupPhotoUrl(id, image) : safeProfilePhotoUrl(id, image);
  return (
    <span aria-hidden="true" className={`person-avatar ${className}`}>
      {url && failedUrl !== url ? (
        <Image
          alt=""
          className="person-avatar__photo"
          height={256}
          onError={() => setFailedUrl(url)}
          src={url}
          unoptimized
          width={256}
        />
      ) : (
        initialsFor(name)
      )}
    </span>
  );
}
