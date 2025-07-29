import { S3_BUCKET, getS3PublicUrl, s3 } from "@/s3";
import { PutBucketAclCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  try {
    // First, make sure the bucket allows public read access
    try {
      const bucketAclCommand = new PutBucketAclCommand({
        Bucket: S3_BUCKET,
        ACL: "public-read",
      });
      await s3.send(bucketAclCommand);
    } catch (aclError) {
      console.warn("Could not set bucket ACL (this is normal for S3 mock):", aclError);
    }

    const exampleContent = "Hello, this is a test file stored in S3!";
    const fileName = `test-file-${Date.now()}.txt`;

    const command = new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: fileName,
      Body: exampleContent,
      ContentType: "text/plain",
      ACL: "public-read", // Make the object publicly readable
    });

    await s3.send(command);

    // Generate the public URL for the uploaded file
    const publicUrl = getS3PublicUrl(fileName);

    return NextResponse.json({
      success: true,
      message: "File uploaded successfully",
      fileName: fileName,
      publicUrl: publicUrl,
      bucket: S3_BUCKET,
    });
  } catch (error) {
    console.error("Error uploading file to S3:", error);
    return NextResponse.json(
      { success: false, error: "Failed to upload file" },
      { status: 500 }
    );
  }
}
