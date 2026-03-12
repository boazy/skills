# Slack Message Formatting Reference

Slack uses its own **mrkdwn** format (not standard Markdown). Use this reference when composing messages.

## Text Formatting

| Style | Syntax | Renders As |
|-------|--------|------------|
| Bold | `*bold text*` | **bold text** |
| Italic | `_italic text_` | _italic text_ |
| Strikethrough | `~strikethrough~` | ~~strikethrough~~ |
| Inline code | `` `code` `` | `code` |

**Combining styles**: `*_bold italic_*` renders as ***bold italic***.

## Links

```
<https://example.com>                    — URL shown directly
<https://example.com|Click here>         — Custom link text
<mailto:user@example.com|Email us>       — Mailto link
```

## Mentions

```
<@U01ABC123>                — Mention a user (by user ID)
<#C01ABC123>                — Mention a channel (by channel ID)
<!here>                     — Notify active members in channel
<!channel>                  — Notify all members in channel
<!everyone>                 — Notify all members in #general
<!subteam^S01ABC123>        — Mention a user group
```

To find user/channel IDs, use `slack-users.ts` or `slack-channels.ts`.

## Emojis

```
:thumbsup:                  — Standard emoji
:heart:                     — Standard emoji
:custom_emoji:              — Custom workspace emoji
:skin-tone-2:               — Skin tone modifier
```

Common emojis: `:white_check_mark:` `:x:` `:warning:` `:rocket:` `:tada:` `:eyes:` `:+1:` `:-1:` `:fire:` `:bug:`

## Lists

Slack has no native list syntax. Use plain text with characters:

```
Bullet list:
• Item one
• Item two
• Item three

Numbered list:
1. First item
2. Second item
3. Third item

Nested (indent with spaces):
• Parent item
    ◦ Child item
    ◦ Another child
```

## Code Blocks

````
Single line: `inline code`

Multi-line code block:
```
function hello() {
  console.log("Hello!");
}
```
````

Note: Slack does not support language-specific syntax highlighting in code blocks (unlike GitHub Markdown).

## Blockquotes

```
> This is a blockquote
> It can span multiple lines
>
> With paragraph breaks
```

Nested blockquotes:
```
> Level one
>>> Everything after >>> is quoted
including this line
and this line
```

`>>>` quotes everything after it to the end of the message.

## Special Formatting

### Date/Time Formatting

Slack has built-in date formatting using Unix timestamps:

```
<!date^1700000000^{date_short} at {time}|November 14, 2023>
```

Tokens: `{date}`, `{date_short}`, `{date_long}`, `{date_pretty}`, `{time}`, `{time_secs}`

### Escaped Characters

| Character | Escape |
|-----------|--------|
| `&` | `&amp;` |
| `<` | `&lt;` |
| `>` | `&gt;` |

## Complete Example

```
*Sprint Retrospective Summary* :memo:

> The team completed 23 story points this sprint.

*What went well:*
• Deployment pipeline improved by 40%
• Zero production incidents :white_check_mark:

*Action items:*
1. <@U01ABC123> — update monitoring dashboards
2. <@U02DEF456> — document new API endpoints

See full details: <https://wiki.example.com/retro-2024|Sprint Retro Notes>

_Next planning session: <!date^1700000000^{date_short} at {time}|Nov 14>_
```
