import type { Metadata } from "next";

import { FadeIn } from "@/components/fade-in";
import { MobileTableOfContents } from "@/components/mobile-table-of-contents";
import { AiTools } from "@/components/sections/ai-tools";
import { PageHero } from "@/components/sections/page-hero";
import { AI_SECTIONS, flattenSections } from "@/lib/sections";

const mobileSections = flattenSections(AI_SECTIONS);

export const metadata: Metadata = {
  alternates: { canonical: "/ai" },
  description:
    "First-class tool factories for OpenAI, the Vercel AI SDK, and the Claude Agent SDK — same eight operations, Zod-validated, approval-gated by default.",
  openGraph: { url: "/ai" },
  title: "AI tools",
};

const AiPage = () => (
  <>
    <PageHero
      title="AI tools"
      description="Files SDK ships first-class tool factories for the most common LLM integrations. Each one wraps a configured Files instance into the shape that provider expects — same eight operations, Zod-validated input contracts, approval-gating defaults — so the model can browse, read, and (optionally) mutate your bucket through the same unified surface as your application code. Each is independently tree-shakeable and pulls in only the peer dependencies it needs."
    />
    <FadeIn className="lg:hidden">
      <MobileTableOfContents sections={mobileSections} />
    </FadeIn>
    <FadeIn>
      <AiTools />
    </FadeIn>
  </>
);

export default AiPage;
