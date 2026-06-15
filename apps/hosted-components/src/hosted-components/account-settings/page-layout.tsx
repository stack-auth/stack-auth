import React from "react";
import { getPageLayoutGapClassName, useDesign } from "./design-context";

export function PageLayout(props: { children: React.ReactNode }) {
  const design = useDesign();
  return (
    <div className={`flex flex-col ${getPageLayoutGapClassName(design)}`}>
      {props.children}
    </div>
  );
}
