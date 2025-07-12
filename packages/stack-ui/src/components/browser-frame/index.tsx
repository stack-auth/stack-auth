import React from "react";

export type Props = {
  url?: string,
  padding?: string,
  transparentBackground?: boolean,
  children: React.ReactNode,
  className?: string,
};

export const BrowserFrame = ({ url, padding, transparentBackground, children, className }: Props) => (
  <div className={`rounded-xl overflow-hidden shadow-2xl ${className}`}>
    <div className="bg-gray-200 dark:bg-gray-800 h-10 flex items-center py-2 px-4 box-border">
      <div className="w-3 h-3 bg-red-500 rounded-full mr-1.5 flex-shrink-0" />
      <div className="w-3 h-3 bg-yellow-500 rounded-full mr-1.5 flex-shrink-0" />
      <div className="w-3 h-3 bg-green-500 rounded-full mr-2 flex-shrink-0" />
      {url && (
        <div
          className="text-left bg-white dark:bg-gray-700 h-6 rounded-full leading-6 text-sm text-gray-700 dark:text-gray-300 flex-grow ml-2 mr-4 px-4 whitespace-nowrap overflow-hidden overflow-ellipsis"
          aria-hidden
        >
          {url}
        </div>
      )}
      <div className="w-4 h-4 ml-auto flex flex-col justify-evenly items-stretch flex-shrink-0">
        <span className="h-0.5 bg-gray-400 dark:bg-gray-500" />
        <span className="h-0.5 bg-gray-400 dark:bg-gray-500" />
        <span className="h-0.5 bg-gray-400 dark:bg-gray-500" />
      </div>
    </div>
    <div
      className={`flex grow flex-col p-4 rounded-b-md ${padding ? padding : ""} ${
        transparentBackground
          ? ""
          : "bg-white dark:bg-black"
      }`}
      style={transparentBackground ? {
        backgroundImage: `
          linear-gradient(45deg, #f0f0f0 25%, transparent 25%), 
          linear-gradient(-45deg, #f0f0f0 25%, transparent 25%), 
          linear-gradient(45deg, transparent 75%, #f0f0f0 75%), 
          linear-gradient(-45deg, transparent 75%, #f0f0f0 75%)
        `,
        backgroundSize: '20px 20px',
        backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px'
      } : {}}
    >
      {children}
    </div>
  </div>
);
