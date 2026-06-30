import React from "react";
import {
  getCardClassName,
  getSectionDescriptionClassName,
  getSectionLayoutClassName,
  getSectionTitleClassName,
  useDesign,
} from "./design-context";

export function Section(props: { title: string, description?: string, children: React.ReactNode }) {
  const design = useDesign();
  return (
    <div className={getCardClassName(design, getSectionLayoutClassName(design))}>
      <div className="flex-1 flex flex-col justify-center min-w-0">
        <h3 className={getSectionTitleClassName(design)}>
          {props.title}
        </h3>
        {props.description && (
          <p className={getSectionDescriptionClassName(design)}>
            {props.description}
          </p>
        )}
      </div>
      <div className="w-full md:w-auto flex flex-col md:items-end justify-end shrink-0">
        {props.children}
      </div>
    </div>
  );
}
