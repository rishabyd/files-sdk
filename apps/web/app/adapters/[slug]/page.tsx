import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AdapterInstallation } from "@/components/adapter-installation";
import { FadeIn } from "@/components/fade-in";
import { PageHero } from "@/components/sections/page-hero";
import { ADAPTERS, getAdapter } from "@/lib/adapters";

interface AdapterPageProps {
  params: Promise<{ slug: string }>;
}

export const generateStaticParams = () =>
  ADAPTERS.map(({ slug }) => ({ slug }));

export const generateMetadata = async ({
  params,
}: AdapterPageProps): Promise<Metadata> => {
  const { slug } = await params;
  const adapter = getAdapter(slug);

  if (!adapter) {
    return {};
  }

  return {
    alternates: { canonical: `/adapters/${adapter.slug}` },
    description: adapter.description,
    openGraph: { url: `/adapters/${adapter.slug}` },
    title: adapter.name,
  };
};

const AdapterPage = async ({ params }: AdapterPageProps) => {
  const { slug } = await params;
  const adapter = getAdapter(slug);

  if (!adapter) {
    notFound();
  }

  const { Component, name, description, peerDeps } = adapter;

  return (
    <>
      <PageHero description={description} title={name} />
      <FadeIn className="flex flex-col gap-8">
        <AdapterInstallation peerDeps={peerDeps} />
        <Component />
      </FadeIn>
    </>
  );
};

export default AdapterPage;
