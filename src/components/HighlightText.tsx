import React from 'react';

interface HighlightTextProps {
  text: string;
  query: string;
}

export const HighlightText: React.FC<HighlightTextProps> = ({ text, query }) => {
  const cleanQuery = query.trim();
  if (!cleanQuery || !text) {
    return <>{text}</>;
  }

  const terms = cleanQuery
    .split(/\s+/)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .filter(Boolean);

  if (terms.length === 0) {
    return <>{text}</>;
  }

  const regex = new RegExp(`(${terms.join('|')})`, 'gi');
  const parts = text.split(regex);

  return (
    <>
      {parts.map((part, idx) => {
        const isMatch = terms.some((term) => new RegExp(`^${term}$`, 'i').test(part));
        return isMatch ? (
          <mark
            key={idx}
            className="bg-yellow-400/20 text-yellow-300 rounded-xs px-0.5 font-medium"
          >
            {part}
          </mark>
        ) : (
          <React.Fragment key={idx}>{part}</React.Fragment>
        );
      })}
    </>
  );
};
