import { useEffect, useState, type InputHTMLAttributes } from "react";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> & {
  value: string;
  onValueChange: (value: string) => void;
};
// Keep the typing buffer separate from normalized bilingual storage. In particular,
// a space typed between words must survive even when the stored value is trimmed.
export function ConsentTextInput({ value, onValueChange, ...props }: Props) {
  const [text, setText] = useState(value);
  useEffect(() => { setText(value); }, [value]);
  return <input {...props} value={text} onChange={event => {
    const next = event.target.value;
    setText(next);
    onValueChange(next);
  }} />;
}
