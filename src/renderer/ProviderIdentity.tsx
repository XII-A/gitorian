import { useState } from 'react'
import { GitlabLogoIcon } from '@phosphor-icons/react/dist/csr/GitlabLogo'
import { UserRound } from 'lucide-react'
import type { AccountSummary, Provider } from '../shared/provider-accounts'

const avatarSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

export function ProviderLogo({ provider }: { provider: Provider }) {
    return (
        <span
            className={`account-provider-logo account-provider-logo--${provider}`}
            title={provider === 'github' ? 'GitHub' : 'GitLab'}
        >
            {provider === 'github' ? (
                <span className="account-github-mark" aria-hidden="true" />
            ) : (
                <GitlabLogoIcon size={24} weight="fill" aria-hidden="true" />
            )}
        </span>
    )
}

export function AccountAvatar({ account }: { account: AccountSummary }) {
    const [failedUrl, setFailedUrl] = useState<string>()
    const avatarUrl =
        account.avatarUrl ??
        (account.provider === 'github'
            ? `https://avatars.githubusercontent.com/u/${encodeURIComponent(account.userId)}?s=80`
            : undefined)
    const [first, second] = avatarSegmenter.segment(account.username.trim())
    const initials = [first?.segment, second?.segment].join('').toUpperCase()
    return (
        <span className="account-avatar" aria-hidden="true">
            {avatarUrl && failedUrl !== avatarUrl ? (
                <img src={avatarUrl} alt="" onError={() => setFailedUrl(avatarUrl)} />
            ) : (
                initials || <UserRound size={18} strokeWidth={1.5} />
            )}
        </span>
    )
}
