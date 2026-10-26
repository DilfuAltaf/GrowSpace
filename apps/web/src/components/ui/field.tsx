import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import { useId } from 'react';
import { cn } from '@/lib/utils';

interface FieldProps {
  label: string;
  htmlFor: string;
  error?: string | null;
  hint?: ReactNode;
  children: ReactNode;
  optional?: boolean;
}

export function Field({ label, htmlFor, error, hint, children, optional }: FieldProps) {
  return (
    <div>
      <label className="field-label" htmlFor={htmlFor}>
        {label}
        {optional ? <span className="ml-1 font-normal text-muted">(optional)</span> : null}
      </label>
      {children}
      {hint && !error ? <p className="mt-1.5 text-sm text-muted">{hint}</p> : null}
      {error ? (
        <p className="field-error" id={`${htmlFor}-error`} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string;
  error?: string | null;
  hint?: ReactNode;
  optional?: boolean;
}

export function TextField({ label, error, hint, optional, className, ...props }: TextFieldProps) {
  const id = useId();
  return (
    <Field label={label} htmlFor={id} error={error} hint={hint} optional={optional}>
      <input
        id={id}
        className={cn('field-input', error && 'border-critical', className)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        {...props}
      />
    </Field>
  );
}

interface TextAreaFieldProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> {
  label: string;
  error?: string | null;
  hint?: ReactNode;
  optional?: boolean;
}

export function TextAreaField({
  label,
  error,
  hint,
  optional,
  className,
  ...props
}: TextAreaFieldProps) {
  const id = useId();
  return (
    <Field label={label} htmlFor={id} error={error} hint={hint} optional={optional}>
      <textarea
        id={id}
        className={cn('field-input min-h-24 py-2.5', error && 'border-critical', className)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        {...props}
      />
    </Field>
  );
}

interface SelectFieldProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> {
  label: string;
  error?: string | null;
  hint?: ReactNode;
  optional?: boolean;
  children: ReactNode;
}

export function SelectField({
  label,
  error,
  hint,
  optional,
  className,
  children,
  ...props
}: SelectFieldProps) {
  const id = useId();
  return (
    <Field label={label} htmlFor={id} error={error} hint={hint} optional={optional}>
      <select
        id={id}
        className={cn('field-input', error && 'border-critical', className)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        {...props}
      >
        {children}
      </select>
    </Field>
  );
}
