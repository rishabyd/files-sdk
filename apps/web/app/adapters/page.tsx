import type { Metadata } from "next";

import { FadeIn } from "@/components/fade-in";
import { MobileTableOfContents } from "@/components/mobile-table-of-contents";
import { Adapters } from "@/components/sections/adapters";
import { PageHero } from "@/components/sections/page-hero";
import { ADAPTER_SECTIONS, flattenSections } from "@/lib/sections";

const mobileSections = flattenSections(ADAPTER_SECTIONS);

export const metadata: Metadata = {
  alternates: { canonical: "/adapters" },
  description:
    "Adapters for every supported provider — S3, R2, Vercel Blob, Netlify Blobs, MinIO, GCS, Azure, Supabase, Google Drive, Dropbox, and more.",
  openGraph: { url: "/adapters" },
  title: "Adapters",
};

const AdaptersPage = () => (
  <>
    <PageHero
      title="Adapters"
      description="Each adapter is a subpath import. Bring only what you use; the others tree-shake away. Adapters auto-load credentials from the standard environment variables for that provider — pass options explicitly to override. If an adapter is constructed without enough info to authenticate, it throws at construction time naming the missing variable."
    />
    <FadeIn className="lg:hidden">
      <MobileTableOfContents sections={mobileSections} />
    </FadeIn>
    <FadeIn>
      <Adapters />
    </FadeIn>
  </>
);

export default AdaptersPage;
