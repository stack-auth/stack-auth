import { MtlsKeyAlgorithm } from "@hexclave/shared/dist/utils/mtls";
import { runAsynchronously, runAsynchronouslyWithAlert } from "@hexclave/shared/dist/utils/promises";
import { Button, Input, Label, Typography } from "@hexclave/ui";
import { useEffect, useState } from "react";
import { useStackApp } from "../../..";
import { generateSelfSignedCertificate } from "../../../lib/mtls";
import { useUser } from "../../../lib/hooks";
import { useTranslation } from "../../../lib/translations";
import { FormWarningText } from "../../../components/elements/form-warning";
import { Section } from "../section";
import type { MtlsCertificateInfo } from "@hexclave/shared/dist/utils/mtls";

type Mode = "none" | "upload" | "generate";

export function CertificateSection(props?: {
  mockMode?: boolean,
}) {
  const { t } = useTranslation();
  const user = useUser({ or: props?.mockMode ? 'return-null' : "throw" });

  if (props?.mockMode && !user) {
    return (
      <Section
        title={t("Client certificates (mTLS)")}
        description={t("Certificate management is not available in demo mode.")}
      >
        <Typography variant='secondary'>{t("Certificate management is not available in demo mode.")}</Typography>
      </Section>
    );
  }

  if (!user) {
    return null;
  }

  const hexclaveApp = useStackApp();
  const project = hexclaveApp.useProject();

  const [certificates, setCertificates] = useState<MtlsCertificateInfo[] | undefined>(undefined);
  const [mode, setMode] = useState<Mode>("none");
  const [error, setError] = useState<string | undefined>(undefined);

  // Upload form state
  const [certificatePem, setCertificatePem] = useState<string | undefined>(undefined);
  const [privateKeyPem, setPrivateKeyPem] = useState<string | undefined>(undefined);
  const [displayName, setDisplayName] = useState("");

  // Generate form state
  const [keyAlgorithm, setKeyAlgorithm] = useState<MtlsKeyAlgorithm>("EC");
  const [commonName, setCommonName] = useState("");

  const reload = () => runAsynchronously((async () => {
    setCertificates(await user.listCertificates());
  })());

  useEffect(() => {
    if (project.config.mtlsEnabled) reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!project.config.mtlsEnabled) {
    return null;
  }

  const resetForms = () => {
    setMode("none");
    setError(undefined);
    setCertificatePem(undefined);
    setPrivateKeyPem(undefined);
    setDisplayName("");
    setCommonName("");
  };

  const onRegisterUploaded = async () => {
    setError(undefined);
    if (!certificatePem || !privateKeyPem) {
      setError(t("Please select both your certificate and private key files."));
      return;
    }
    const result = await user.registerCertificate({ certificatePem, privateKeyPem, displayName: displayName || undefined });
    if (result.status === "error") {
      setError(result.error.message);
      return;
    }
    resetForms();
    reload();
  };

  const onGenerateAndRegister = async () => {
    setError(undefined);
    const name = commonName.trim() || (user.displayName ?? user.primaryEmail ?? "Hexclave User");
    const generated = await generateSelfSignedCertificate({ keyAlgorithm, commonName: name });

    // Let the user download the keypair before we register the public certificate.
    downloadTextFile(`${sanitizeFileName(name)}-certificate.pem`, generated.certificatePem);
    downloadTextFile(`${sanitizeFileName(name)}-private-key.pem`, generated.privateKeyPem);

    const result = await user.registerCertificate({
      certificatePem: generated.certificatePem,
      privateKeyPem: generated.privateKeyPem,
      displayName: name,
    });
    if (result.status === "error") {
      setError(result.error.message);
      return;
    }
    resetForms();
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
    <Section
      title={t("Client certificates (mTLS)")}
      description={t("Register X.509 client certificates to sign in with mutual TLS.")}
    >
      <div className='flex flex-col gap-3'>
        {certificates === undefined ? (
          <Typography variant='secondary' type='label'>{t("Loading...")}</Typography>
        ) : certificates.length === 0 ? (
          <Typography variant='secondary' type='label'>{t("No certificates registered yet.")}</Typography>
        ) : (
          <div className='flex flex-col gap-2'>
            {certificates.map((cert) => (
              <div key={cert.id} className='flex items-center justify-between gap-2 border rounded-md p-2'>
                <div className='flex flex-col min-w-0'>
                  <Typography type='label' className='truncate'>{cert.displayName || cert.subject}</Typography>
                  <Typography variant='secondary' type='footnote' className='truncate'>
                    {t("Expires")} {new Date(cert.validTo).toLocaleDateString()} · {cert.fingerprint.slice(0, 16)}…
                  </Typography>
                </div>
                <Button variant='secondary' onClick={() => onRevoke(cert.id)}>{t("Revoke")}</Button>
              </div>
            ))}
          </div>
        )}

        {mode === "none" && (
          <div className='flex gap-2 md:justify-end'>
            <Button variant='secondary' onClick={() => { resetForms(); setMode("upload"); }}>{t("Upload certificate")}</Button>
            <Button variant='secondary' onClick={() => { resetForms(); setMode("generate"); }}>{t("Generate certificate")}</Button>
          </div>
        )}

        {mode === "upload" && (
          <div className='flex flex-col gap-2 border rounded-md p-3'>
            <Label className='text-sm'>{t("Certificate (PEM)")}</Label>
            <input type='file' accept='.pem,.crt,.cer' className='text-sm'
              onChange={(e) => { const f = e.target.files?.[0]; runAsynchronouslyWithAlert((async () => setCertificatePem(f ? await f.text() : undefined))()); }} />
            <Label className='text-sm mt-2'>{t("Private key (PEM)")}</Label>
            <input type='file' accept='.pem,.key' className='text-sm'
              onChange={(e) => { const f = e.target.files?.[0]; runAsynchronouslyWithAlert((async () => setPrivateKeyPem(f ? await f.text() : undefined))()); }} />
            <Label className='text-sm mt-2'>{t("Name (optional)")}</Label>
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder={t("My work laptop")} />
            <FormWarningText text={error} />
            <div className='flex gap-2 mt-1'>
              <Button onClick={onRegisterUploaded}>{t("Register")}</Button>
              <Button variant='secondary' onClick={resetForms}>{t("Cancel")}</Button>
            </div>
          </div>
        )}

        {mode === "generate" && (
          <div className='flex flex-col gap-2 border rounded-md p-3'>
            <Typography variant='secondary' type='footnote'>
              {t("We'll generate a certificate and private key in your browser and download them. Keep the private key safe — you'll need it to sign in.")}
            </Typography>
            <Label className='text-sm mt-1'>{t("Key type")}</Label>
            <select className='text-sm border rounded-md p-2 bg-transparent' value={keyAlgorithm} onChange={(e) => setKeyAlgorithm(e.target.value === "RSA" ? "RSA" : "EC")}>
              <option value='EC'>{t("Elliptic Curve (P-256, recommended)")}</option>
              <option value='RSA'>{t("RSA (2048-bit)")}</option>
            </select>
            <Label className='text-sm mt-2'>{t("Name (optional)")}</Label>
            <Input value={commonName} onChange={(e) => setCommonName(e.target.value)} placeholder={t("My work laptop")} />
            <FormWarningText text={error} />
            <div className='flex gap-2 mt-1'>
              <Button onClick={onGenerateAndRegister}>{t("Generate & register")}</Button>
              <Button variant='secondary' onClick={resetForms}>{t("Cancel")}</Button>
            </div>
          </div>
        )}

        {mode === "none" && <FormWarningText text={error} />}
      </div>
    </Section>
  );
}

function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([content], { type: "application/x-pem-file" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9-_]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "certificate";
}
