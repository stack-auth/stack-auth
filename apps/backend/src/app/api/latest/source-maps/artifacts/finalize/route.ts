import { ArtifactUploadService } from "@/lib/artifacts/artifact-upload-service";
import { createArtifactFinalizeRoute } from "@/lib/artifacts/artifact-route-handlers";

export const POST = createArtifactFinalizeRoute(ArtifactUploadService.production());
