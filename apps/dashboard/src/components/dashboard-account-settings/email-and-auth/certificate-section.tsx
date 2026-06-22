'use client';

import { Button } from "@/components/ui/button";
import { runAsynchronously, runAsynchronouslyWithAlert } from "@hexclave/shared/dist/utils/promises";
import type { MtlsCertificateInfo } from "@hexclave/shared/dist/utils/mtls";
import { useEffect, useState } from "react";
import { useStackApp, useUser } from "@hexclave/next";
import { Section } from "../section";

export function CertificateSection(props?: {
  mockMode?: boolean,
}) {
  const isInMockMode = !!props?.mockMode;
  const user = useUser({ or: isInMockMode ? 'return-null' : "redirect" });
  const stackApp = useStackApp();
  const project = stackApp.useProject();

  if (isInMockMode && !user) {
    return (
      <Section title="Client certificates (mTLS)" description="Certificate management is not available in demo mode.">
        <span className="text-sm text-muted-foreground">Certificate management is not available in demo mode.</span>
      </Section>
    );
  }

  if (!user || !project.config.mtlsEnabled) {
    return null;
  }

  return <CertificateSectionInner user={user} />;
}

// The SDK user type isn't fully known to the dashboard's tsconfig until the package is rebuilt; the
// passkey section uses the same `user: any` pattern.
function CertificateSectionInner({ user }: { user: any }) {
  const [certificates, setCertificates] = useState<MtlsCertificateInfo[] | undefined>(undefined);
  const [showUpload, setShowUpload] = useState(false);
  const [certificatePem, setCertificatePem] = useState<string | undefined>(undefined);
  const [privateKeyPem, setPrivateKeyPem] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  const reload = () => runAsynchronously((async () => {
    setCertificates(await user.listCertificates());
  })());

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onRegister = async () => {
    setError(undefined);
    if (!certificatePem || !privateKeyPem) {
      setError("Please select both your certificate and private key files.");
      return;
    }
    const result = await user.registerCertificate({ certificatePem, privateKeyPem });
    if (result.status === "error") {
      setError(result.error.message);
      return;
    }
    setShowUpload(false);
    setCertificatePem(undefined);
    setPrivateKeyPem(undefined);
    reload();
  };

  const onRevoke = async (id: string) => {
    setError(undefined);
    const result = await user.deleteCertificate(id);
    if (result.status === "error") {
      setError(result.error.message);
      return;
    }
    reload();
  };

  return (
    <Section title="Client certificates (mTLS)" description="Register X.509 client certificates to sign in with mutual TLS.">
      <div className="flex flex-col gap-3">
        {certificates === undefined ? (
          <span className="text-sm text-muted-foreground">Loading...</span>
        ) : certificates.length === 0 ? (
          <span className="text-sm text-muted-foreground">No certificates registered yet.</span>
        ) : (
          <div className="flex flex-col gap-2">
            {certificates.map((cert) => (
              <div key={cert.id} className="flex items-center justify-between gap-2 border rounded-md p-2">
                <div className="flex flex-col min-w-0">
                  <span className="text-sm font-medium truncate">{cert.displayName || cert.subject}</span>
                  <span className="text-xs text-muted-foreground truncate">
                    Expires {new Date(cert.validTo).toLocaleDateString()} · {cert.fingerprint.slice(0, 16)}…
                  </span>
                </div>
                <Button variant="secondary" onClick={() => onRevoke(cert.id)}>Revoke</Button>
              </div>
            ))}
          </div>
        )}

        {!showUpload ? (
          <div className="flex md:justify-end">
            <Button variant="secondary" onClick={() => { setError(undefined); setShowUpload(true); }}>Upload certificate</Button>
          </div>
        ) : (
          <div className="flex flex-col gap-2 border rounded-md p-3">
            <label className="text-sm">Certificate (PEM)</label>
            <input type="file" accept=".pem,.crt,.cer" className="text-sm"
              onChange={(e) => { const f = e.target.files?.[0]; runAsynchronouslyWithAlert((async () => setCertificatePem(f ? await f.text() : undefined))()); }} />
            <label className="text-sm mt-2">Private key (PEM)</label>
            <input type="file" accept=".pem,.key" className="text-sm"
              onChange={(e) => { const f = e.target.files?.[0]; runAsynchronouslyWithAlert((async () => setPrivateKeyPem(f ? await f.text() : undefined))()); }} />
            {error && <span className="text-sm text-destructive">{error}</span>}
            <div className="flex gap-2 mt-1">
              <Button onClick={onRegister}>Register</Button>
              <Button variant="secondary" onClick={() => { setShowUpload(false); setError(undefined); }}>Cancel</Button>
            </div>
          </div>
        )}
        {!showUpload && error && <span className="text-sm text-destructive">{error}</span>}
      </div>
    </Section>
  );
}
