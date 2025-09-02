import { DayInterval } from "@stackframe/stack-shared/dist/utils/dates";
import { Control, FieldValues, Path } from "react-hook-form";
import { FieldLabel } from "../form-fields";
import { FormControl, SelectValue, SelectTrigger, SelectItem, SelectContent, FormItem, FormMessage, Select, SelectGroup, FormField } from "@stackframe/stack-ui";

const intervalOptions = [
  { value: "1-week", label: "1 week" },
  { value: "1-month", label: "1 month" },
  { value: "1-year", label: "1 year" },
];

export function DayIntervalSelectorField<F extends FieldValues>(props: {
  control: Control<F>,
  name: Path<F>,
  label: React.ReactNode,
  required?: boolean,
  includeNever?: boolean,
  unsetLabel?: string,
}) {

  const convertToDayInterval = (value: string): DayInterval | undefined => {
    const [amount, unit] = value.split("-");
    const n = parseInt(amount);
    if (!Number.isFinite(n) || !unit) return;
    if (!["day", "week", "month", "year"].includes(unit)) return;
    return [n, unit as DayInterval[1]];
  };

  const formatDayInterval = (interval: DayInterval | undefined): string | undefined => {
    if (!interval) return undefined;
    return `${interval[0]}-${interval[1]}`;
  };

  return (
    <FormField
      control={props.control}
      name={props.name}
      render={({ field }) => (
        <FormItem>
          <FieldLabel required={props.required}>{props.label}</FieldLabel>
          <FormControl>
            <Select
              defaultValue={formatDayInterval(field.value as DayInterval)}
              onValueChange={(value) => field.onChange(value === "__unset__" ? undefined : convertToDayInterval(value))}
            >
              <SelectTrigger className="max-w-lg">
                <SelectValue placeholder={props.unsetLabel} />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {props.unsetLabel && <SelectItem value={"__unset__"}>{props.unsetLabel}</SelectItem>}
                  {props.includeNever && <SelectItem value="never">Never</SelectItem>}
                  {intervalOptions.map(option => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
