import { useLayoutEffect, useState, type TextareaHTMLAttributes } from "react";

/** One entry per line, trimmed, without blanks or repeats. Commas stay inside an entry ("Annapolis, MD"). */
export function parseLineList(text: string): string[] {
  return Array.from(new Set(text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)));
}

function sameList(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

type LineListTextareaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange"> & {
  values: readonly string[];
  onValuesChange: (values: string[]) => void;
};

/**
 * A textarea for a list with one entry per line. It keeps exactly what the person types (spaces,
 * a new empty line) and reports the parsed list; parsing the text and writing it back on every
 * keystroke used to delete the space or line break just typed. A change from outside (loading,
 * resetting) replaces the text.
 */
export function LineListTextarea({ values, onValuesChange, ...props }: LineListTextareaProps) {
  const [text, setText] = useState(() => values.join("\n"));

  // A layout effect, so a switched or cleared form never shows the previous text for a frame.
  useLayoutEffect(() => {
    setText((current) => {
      if (!sameList(parseLineList(current), values)) return values.join("\n");
      // An emptied list (new or cleared form) also clears leftover blank lines or spaces.
      return values.length === 0 ? "" : current;
    });
  }, [values]);

  return (
    <textarea
      {...props}
      value={text}
      onChange={(event) => {
        setText(event.target.value);
        onValuesChange(parseLineList(event.target.value));
      }}
    />
  );
}
