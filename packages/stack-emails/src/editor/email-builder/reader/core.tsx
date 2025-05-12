import { z } from 'zod';
import { Button, ButtonPropsSchema } from '../../blocks/block-button';
import { Divider, DividerPropsSchema } from '../../blocks/block-divider';
import { Heading, HeadingPropsSchema } from '../../blocks/block-heading';
import { Image, ImagePropsSchema } from '../../blocks/block-image';
import { Spacer, SpacerPropsSchema } from '../../blocks/block-spacer';
import { Text, TextPropsSchema } from '../../blocks/block-text';
import {
  buildBlockComponent,
  buildBlockConfigurationDictionary,
  buildBlockConfigurationSchema,
} from '../../document-core';
import ColumnsContainerPropsSchema from '../blocks/columns-container/columns-container-props-schema';
import ColumnsContainerReader from '../blocks/columns-container/columns-container-reader';
import { ContainerPropsSchema } from '../blocks/container/container-props-schema';
import ContainerReader from '../blocks/container/container-reader';
import { EmailLayoutPropsSchema } from '../blocks/email-layout/email-layout-props-schema';
import EmailLayoutReader from '../blocks/email-layout/email-layout-reader';
import { TEditorConfiguration } from '../../documents/editor/core';
import { StackAssertionError } from '@stackframe/stack-shared/dist/utils/errors';

const READER_DICTIONARY = buildBlockConfigurationDictionary({
  ColumnsContainer: {
    schema: ColumnsContainerPropsSchema,
    Component: ColumnsContainerReader,
  },
  Container: {
    schema: ContainerPropsSchema,
    Component: ContainerReader,
  },
  EmailLayout: {
    schema: EmailLayoutPropsSchema,
    Component: EmailLayoutReader,
  },
  Button: {
    schema: ButtonPropsSchema,
    Component: Button,
  },
  Divider: {
    schema: DividerPropsSchema,
    Component: Divider,
  },
  Heading: {
    schema: HeadingPropsSchema,
    Component: Heading,
  },
  Image: {
    schema: ImagePropsSchema,
    Component: Image,
  },
  Spacer: {
    schema: SpacerPropsSchema,
    Component: Spacer,
  },
  Text: {
    schema: TextPropsSchema,
    Component: Text,
  },
});

export const ReaderBlockSchema = buildBlockConfigurationSchema(READER_DICTIONARY);
export type TReaderBlock = z.infer<typeof ReaderBlockSchema>;

export const ReaderDocumentSchema = z.record(z.string(), ReaderBlockSchema);
export type TReaderDocument = Record<string, TReaderBlock>;

const BaseReaderBlock = buildBlockComponent(READER_DICTIONARY);

export type TReaderBlockProps = { id: string, document?: TEditorConfiguration };
export function ReaderBlock({ id, document }: TReaderBlockProps) {
  if (!document) throw new StackAssertionError('document is required for ReaderBlock');
  return <BaseReaderBlock {...document[id]} document={document} />;
}

export type TReaderProps = {
  document: TEditorConfiguration,
  rootBlockId: string,
};
export default function Reader({ document, rootBlockId }: TReaderProps) {
  return (
    <ReaderBlock id={rootBlockId} document={document}/>
  );
}
