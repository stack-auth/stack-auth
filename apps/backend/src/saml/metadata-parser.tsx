/**
 * Parse pasted IdP metadata XML into the fields we need to construct a
 * SamlConnectionConfig. The dashboard "Add SAML connection" form lets a
 * customer paste this XML so they don't have to copy each field manually.
 */
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";
import { DOMParser } from "@xmldom/xmldom";
import * as xpath from "xpath";

export type ParsedIdpMetadata = {
  entityId: string,
  ssoUrl: string,
  /** Bare base64 cert (no PEM headers). Caller wraps in headers if needed. */
  signingCertificate: string,
};

const SELECT = xpath.useNamespaces({
  md: "urn:oasis:names:tc:SAML:2.0:metadata",
  ds: "http://www.w3.org/2000/09/xmldsig#",
});

export function parseIdpMetadataXml(xml: string): ParsedIdpMetadata {
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(xml, "text/xml") as unknown as Document;
  } catch (err: unknown) {
    throw new StatusError(StatusError.BadRequest, `Could not parse IdP metadata XML: ${(err as Error).message}`);
  }

  const entityId = (SELECT("string(/md:EntityDescriptor/@entityID)", doc) as string).trim();
  if (!entityId) {
    throw new StatusError(StatusError.BadRequest, "IdP metadata has no /md:EntityDescriptor/@entityID");
  }

  // V1: we only emit AuthnRequests over HTTP-Redirect (node-saml's
  // getAuthorizeUrlAsync produces a Redirect-style GET). Accepting POST-only
  // metadata would store a POST endpoint that we'd later send a Redirect
  // request to — likely rejected by the IdP. Reject up-front with a clear
  // error; POST-binding emission can be added later if needed.
  const ssoUrl = (SELECT(
    "string(/md:EntityDescriptor/md:IDPSSODescriptor/md:SingleSignOnService[@Binding='urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect']/@Location)",
    doc,
  ) as string).trim();
  if (!ssoUrl) {
    const postUrl = (SELECT(
      "string(/md:EntityDescriptor/md:IDPSSODescriptor/md:SingleSignOnService[@Binding='urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST']/@Location)",
      doc,
    ) as string).trim();
    if (postUrl) {
      throw new StatusError(StatusError.BadRequest, "IdP metadata only advertises an HTTP-POST SingleSignOnService binding. Stack Auth's SAML SP currently requires HTTP-Redirect.");
    }
    throw new StatusError(StatusError.BadRequest, "IdP metadata has no SingleSignOnService with HTTP-Redirect binding");
  }

  // Prefer the signing-only KeyDescriptor; fall back to one without `use=`
  // (which means it's valid for both signing and encryption per spec).
  const signingCert =
    (SELECT(
      "string(/md:EntityDescriptor/md:IDPSSODescriptor/md:KeyDescriptor[@use='signing']/ds:KeyInfo/ds:X509Data/ds:X509Certificate)",
      doc,
    ) as string).trim()
    || (SELECT(
      "string(/md:EntityDescriptor/md:IDPSSODescriptor/md:KeyDescriptor[not(@use)]/ds:KeyInfo/ds:X509Data/ds:X509Certificate)",
      doc,
    ) as string).trim();
  if (!signingCert) {
    throw new StatusError(StatusError.BadRequest, "IdP metadata has no signing X509Certificate");
  }

  return {
    entityId,
    ssoUrl,
    signingCertificate: signingCert.replace(/\s+/g, ""),
  };
}
