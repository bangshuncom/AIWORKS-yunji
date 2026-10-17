// 表单字段：Label + 输入控件的统一封装，复用 shared 的 field 布局
import { Label, Input } from '@fluentui/react-components';
import { useSharedStyles } from '../../styles/shared';

export function FormField({
  id,
  label,
  ...inputProps
}: {
  id: string;
  label: string;
} & React.ComponentProps<typeof Input>) {
  const s = useSharedStyles();
  return (
    <div className={s.field}>
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} {...inputProps} />
    </div>
  );
}
