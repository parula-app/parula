export interface ComboOption<T> {
  value: T;
  label: string;
  icon?: ConstructorOfATypedSvelteComponent;
  color?: string;
  disabled?: boolean;
}
