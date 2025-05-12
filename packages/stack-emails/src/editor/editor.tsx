import { deepPlainEquals } from '@stackframe/stack-shared/dist/utils/objects';
import { useEffect, useMemo } from 'react';
import { EmailTemplateMetadata, convertEmailTemplateMetadataExampleValues } from '../utils';
import { TEditorConfiguration } from './documents/editor/core';
import { resetDocument, setDocument, setMetadata, setSubject, useDocument, useSubject } from './documents/editor/editor-context';
import InspectorDrawer from './sidebar';
import TemplatePanel from './template-panel';

export default function EmailEditor(props: {
  document: TEditorConfiguration,
  subject: string,
  metadata: EmailTemplateMetadata,
  onSave?: (document: TEditorConfiguration, subject: string) => void | Promise<void>,
  onCancel?: () => void | Promise<void>,
  resetSignal?: any,
  projectDisplayName: string,
  confirmAlertMessage: string,
  setNeedConfirm: (needConfirm: boolean) => void,
}) {
  const document = useDocument();
  const subject = useSubject();

  useEffect(() => {
    setDocument(props.document);
    setSubject(props.subject);
    setMetadata(convertEmailTemplateMetadataExampleValues(props.metadata, props.projectDisplayName));
  }, [props.document, props.metadata, props.projectDisplayName, props.subject]);

  useEffect(() => {
    if (props.resetSignal) {
      resetDocument(props.document);
    }
  }, [props.resetSignal]);

  const edited = useMemo(() => {
    return !deepPlainEquals(props.document, document) || props.subject !== subject;
  }, [props.document, document, props.subject, subject]);

  useEffect(() => {
    props.setNeedConfirm(edited);
    return () => props.setNeedConfirm(false);
  }, [edited, props.setNeedConfirm]);

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (edited) {
        e.returnValue = props.confirmAlertMessage;
        return props.confirmAlertMessage;
      }
    };

    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [edited]);

  return (
    <div className='flex h-full'>
      <div className='flex grow'>
        <TemplatePanel />
      </div>
      <InspectorDrawer onSave={props.onSave} onCancel={props.onCancel} edited={edited} />
    </div>
  );
}
