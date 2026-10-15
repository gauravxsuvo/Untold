"use client";

import Image from "next/image";
import { useState } from "react";
import { initialsFor } from "@/lib/messaging/people";
import { safeProfilePhotoUrl } from "@/lib/profile/photos";

export function Avatar({
  id,
  name,
  image,
  className = "",
}: {
  id: string;
  name: string;
  image?: string | null;
  className?: string;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const url = safeProfilePhotoUrl(id, image);
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
