import { FolderOpen } from "lucide-react";

import { Badge } from "@/components/ui/badge";

export const Hero = () => (
  <section className="hero mt-16">
    <div className="flex items-center gap-2">
      <FolderOpen className="size-3.5" />
      <h1 className="text-lg font-medium tracking-tight text-foreground">
        files-sdk
      </h1>
      <Badge className="font-mono tabular-nums" variant="secondary">
        v0.0.0
      </Badge>
    </div>
    <p className="text-muted-foreground text-balance leading-relaxed">
      A unified storage SDK for object and blob backends — S3, Cloudflare R2,
      Vercel Blob. One small, honest API. Web-standards I/O. An escape hatch
      when you need the native client.
    </p>
  </section>
);
