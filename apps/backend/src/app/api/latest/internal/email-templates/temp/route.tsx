import { EMAIL_TEMPLATES_METADATA } from "@stackframe/stack-emails/dist/utils";
import { getTransformedTemplateMetadata } from "./convert";

// Used to generate default email templates
// Remove once template migration is complete

// export const GET = async () => {
//   const data = Object.values(EMAIL_TEMPLATES_METADATA).map((metadata) => getTransformedTemplateMetadata(metadata));
//   const obj: Record<string, any> = {};
//   data.forEach((val, key) => {
//     obj[key] = val;
//   });
//   return new Response(
//     JSON.stringify(obj),
//     {
//       headers: {
//         "Content-Type": "application/json",
//       },
//     }
//   );
// };
