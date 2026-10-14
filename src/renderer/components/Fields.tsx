import type {
    HTMLAttributes,
    InputHTMLAttributes,
    ReactNode,
    SelectHTMLAttributes,
    TextareaHTMLAttributes
} from 'react'
import { Children, createContext, isValidElement, useContext, useId } from 'react'

import { Checkbox } from './arc/checkbox/checkbox'
import { DatePicker } from './arc/date-picker/date-picker'
import { Input as ArcInput } from './arc/input/input'
import { Select as ArcSelect } from './arc/select/select'
import { Textarea as ArcTextarea } from './arc/textarea/textarea'

const parse = (value: unknown) => {
    if (typeof value !== 'string' || !value) {
        return
    }
    const [year, month, day] = value.split('-').map(Number)
    return new Date(year, month - 1, day)
}

const FieldName = createContext<string | undefined>(undefined)
export const Field = ({ children, className = '', ...props }: HTMLAttributes<HTMLDivElement>) => {
    const id = useId()
    const parts = Children.toArray(children)
    const caption = parts.filter((child) => !isValidElement(child) || child.type === 'span')
    const controls = parts.filter((child) => isValidElement(child) && child.type !== 'span')
    return (
        <div {...props} className={`field-group ${className}`}>
            <label id={`${id}-label`} htmlFor={id} className="field-caption">
                {caption}
            </label>
            <FieldName.Provider value={id}>{controls}</FieldName.Provider>
        </div>
    )
}
export const Input = (props: InputHTMLAttributes<HTMLInputElement>) => {
    const name = useContext(FieldName)
    if (props.type === 'date') {
        return (
            <DatePicker
                label=""
                id={props.id ?? name}
                aria-labelledby={name ? `${name}-label` : undefined}
                aria-label={props['aria-label']}
                className={props.className}
                disabled={props.disabled}
                value={parse(props.value)}
                minDate={parse(props.min)}
                maxDate={parse(props.max)}
                showToday
                onChange={(date) => {
                    const value = date
                        ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
                        : ''
                    props.onChange?.({ target: { value } } as React.ChangeEvent<HTMLInputElement>)
                }}
            />
        )
    }
    if (props.type === 'checkbox') {
        return (
            <Checkbox
                id={props.id ?? name}
                aria-labelledby={name ? `${name}-label` : undefined}
                checked={props.checked}
                disabled={props.disabled}
                onCheckedChange={(checked) =>
                    props.onChange?.({ target: { checked: checked === true } } as React.ChangeEvent<HTMLInputElement>)
                }
            />
        )
    }
    return <ArcInput label="" id={name} aria-labelledby={name ? `${name}-label` : undefined} {...props} />
}
export const Textarea = (props: TextareaHTMLAttributes<HTMLTextAreaElement>) => {
    const name = useContext(FieldName)
    return <ArcTextarea label="" id={name} aria-labelledby={name ? `${name}-label` : undefined} {...props} />
}
const optionText = (children: ReactNode): string =>
    Children.toArray(children)
        .map((child): string => {
            if (typeof child === 'string' || typeof child === 'number') {
                return String(child)
            }
            return isValidElement<{ children?: ReactNode }>(child) ? optionText(child.props.children) : ''
        })
        .join('')

const optionsFrom = (children: ReactNode): { value: string; label: string; disabled?: boolean }[] =>
    Children.toArray(children).flatMap((child) => {
        if (!isValidElement<{ value?: string | number; children?: ReactNode; disabled?: boolean }>(child)) {
            return []
        }
        if (child.type !== 'option') {
            return optionsFrom(child.props.children)
        }
        const label = optionText(child.props.children)
        return [{ disabled: child.props.disabled, label, value: String(child.props.value ?? label) || '__empty__' }]
    })

export const Select = ({
    children,
    value,
    onChange,
    className,
    id,
    disabled,
    ...props
}: SelectHTMLAttributes<HTMLSelectElement>) => {
    const name = useContext(FieldName)
    return (
        <ArcSelect
            label=""
            aria-labelledby={name ? `${name}-label` : props['aria-labelledby']}
            aria-label={props['aria-label']}
            id={id ?? name}
            disabled={disabled}
            className={className}
            options={optionsFrom(children)}
            value={String(value ?? '') || '__empty__'}
            onValueChange={(next) =>
                onChange?.({
                    target: { value: next === '__empty__' ? '' : next }
                } as React.ChangeEvent<HTMLSelectElement>)
            }
        />
    )
}
