import { Akamai } from "./akamai";
import { Azure } from "./azure";
import { BackblazeB2 } from "./backblaze-b2";
import { Box } from "./box";
import { DigitalOceanSpaces } from "./digitalocean-spaces";
import { Dropbox } from "./dropbox";
import { Fs } from "./fs";
import { Gcs } from "./gcs";
import { GoogleDrive } from "./google-drive";
import { Hetzner } from "./hetzner";
import { Minio } from "./minio";
import { NetlifyBlobs } from "./netlify-blobs";
import { Onedrive } from "./onedrive";
import { R2 } from "./r2";
import { S3 } from "./s3";
import { Storj } from "./storj";
import { Supabase } from "./supabase";
import { Tigris } from "./tigris";
import { Uploadthing } from "./uploadthing";
import { VercelBlob } from "./vercel-blob";
import { Wasabi } from "./wasabi";

export const Adapters = () => (
  <section>
    <S3 />
    <R2 />
    <VercelBlob />
    <NetlifyBlobs />
    <Minio />
    <DigitalOceanSpaces />
    <Storj />
    <Hetzner />
    <Akamai />
    <BackblazeB2 />
    <Wasabi />
    <Tigris />
    <Gcs />
    <GoogleDrive />
    <Onedrive />
    <Dropbox />
    <Box />
    <Azure />
    <Supabase />
    <Uploadthing />
    <Fs />
  </section>
);
