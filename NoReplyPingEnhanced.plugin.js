/**
 * @name NoReplyPingEnhanced
 * @description Automatically sets replies to not ping the target, with per-server include/exclude options.
 * @author ZelionGG
 * @authorId 
 * @authorLink https://github.com/ZelionGG/
 * @version 1.1.0
 * @invite gj7JFa6mF8
 * @source https://github.com/ZelionGG/plugin-NoReplyPingEnhanced/blob/main/NoReplyPingEnhanced.plugin.js
 * @updateUrl https://raw.githubusercontent.com/ZelionGG/plugin-NoReplyPingEnhanced/main/NoReplyPingEnhanced.plugin.js
 */
module.exports = class NoReplyPingEnhanced {
    constructor(meta) {
        this.meta = meta;
        this.api = new BdApi(meta.name);
        this.defaultSettings = {
            mode: "exclude",
            guildIds: [],
            applyInDms: false
        };
        this.settings = this.loadSettings();

        const { Filters } = this.api.Webpack;
        this.replyBar = this.getModuleAndKey(Filters.byStrings('type:"CREATE_PENDING_REPLY"'));
        this.guildStore = this.api.Webpack.getModule((module) => typeof module?.getGuilds === "function", { searchExports: true })
            ?? this.api.Webpack.getModule((module) => typeof module?.getGuild === "function", { searchExports: true });
        this.selectedGuildStore = this.api.Webpack.getModule((module) => typeof module?.getGuildId === "function", { searchExports: true });
    }

    getModuleAndKey(filter) {
        const { getModule } = this.api.Webpack;
        let module;
        const value = getModule((e, m) => (filter(e) ? (module = m) : false), { searchExports: true });
        if (!module) return;
        return [module.exports, Object.keys(module.exports).find((k) => module.exports[k] === value)];
    }

    loadSettings() {
        const saved = BdApi.Data.load(this.meta.name, "settings");
        const settings = {
            ...this.defaultSettings,
            ...(saved && typeof saved === "object" ? saved : {}),
            guildIds: this.normalizeGuildIds(saved?.guildIds)
        };

        return {
            ...settings,
            mode: settings.mode === "include" ? "include" : "exclude",
            applyInDms: Boolean(settings.applyInDms)
        };
    }

    saveSettings() {
        this.settings.guildIds = this.normalizeGuildIds(this.settings.guildIds);
        BdApi.Data.save(this.meta.name, "settings", this.settings);
    }

    normalizeGuildIds(guildIds) {
        if (!Array.isArray(guildIds)) return [];

        return [...new Set(guildIds.filter((guildId) => typeof guildId === "string" && guildId.length > 0))];
    }

    getGuildIdFromProps(props) {
        const guildId = props?.channel?.guild_id
            ?? props?.channel?.guildId
            ?? props?.message?.guild_id
            ?? props?.message?.guildId
            ?? props?.baseMessage?.guild_id
            ?? props?.baseMessage?.guildId
            ?? props?.guildId;

        return typeof guildId === "string" && guildId.length > 0 ? guildId : null;
    }

    getCurrentGuildId(props) {
        return this.getGuildIdFromProps(props)
            ?? this.selectedGuildStore?.getGuildId?.()
            ?? null;
    }

    shouldDisableMention(guildId) {
        if (!guildId) return Boolean(this.settings.applyInDms);

        const isSelected = this.settings.guildIds.includes(guildId);
        return this.settings.mode === "include" ? isSelected : !isSelected;
    }

    getGuilds() {
        const guilds = typeof this.guildStore?.getGuilds === "function"
            ? Object.values(this.guildStore.getGuilds() ?? {})
            : [];

        return guilds
            .filter((guild) => guild && typeof guild.id === "string")
            .sort((left, right) => (left.name || "").localeCompare(right.name || "", undefined, { sensitivity: "base" }));
    }

    toggleGuild(guildId, enabled) {
        const guildIds = new Set(this.settings.guildIds);
        if (enabled) guildIds.add(guildId);
        else guildIds.delete(guildId);

        this.settings.guildIds = [...guildIds];
        this.saveSettings();
    }

    getGuildIconUrl(guild) {
        if (!guild || typeof guild !== "object") return null;

        try {
            if (typeof guild.getIconURL === "function") {
                const iconUrl = guild.getIconURL(64, false);
                if (typeof iconUrl === "string" && iconUrl.length > 0) return iconUrl;
            }
        }
        catch {
            // Ignore and fall back to the raw icon hash.
        }

        const iconHash = guild.icon ?? guild.iconHash;
        if (typeof guild.id !== "string" || typeof iconHash !== "string" || iconHash.length === 0) return null;

        return `https://cdn.discordapp.com/icons/${guild.id}/${iconHash}.png?size=64`;
    }

    getGuildInitials(guild) {
        const name = typeof guild?.name === "string" ? guild.name.trim() : "";
        if (!name) return "?";

        const parts = name.split(/\s+/).filter(Boolean);
        if (!parts.length) return name.slice(0, 2).toUpperCase();

        return parts.slice(0, 2).map((part) => part[0]).join("").toUpperCase();
    }

    createGuildAvatar(guild, size = 20) {
        const avatar = document.createElement("span");
        avatar.style.width = `${size}px`;
        avatar.style.height = `${size}px`;
        avatar.style.flex = "0 0 auto";
        avatar.style.display = "inline-flex";
        avatar.style.alignItems = "center";
        avatar.style.justifyContent = "center";
        avatar.style.overflow = "hidden";
        avatar.style.borderRadius = "50%";
        avatar.style.background = "var(--brand-500, var(--background-accent))";
        avatar.style.color = this.getThemeValue(["--interactive-active", "--white-500"], "#ffffff");
        avatar.style.fontSize = `${Math.max(10, Math.floor(size / 2.2))}px`;
        avatar.style.fontWeight = "700";
        avatar.style.lineHeight = "1";
        avatar.style.textTransform = "uppercase";

        const iconUrl = this.getGuildIconUrl(guild);
        if (iconUrl) {
            const image = document.createElement("img");
            image.src = iconUrl;
            image.alt = "";
            image.width = size;
            image.height = size;
            image.style.width = "100%";
            image.style.height = "100%";
            image.style.objectFit = "cover";
            image.addEventListener("error", () => {
                avatar.replaceChildren(this.getGuildInitials(guild));
            }, { once: true });
            avatar.append(image);
            return avatar;
        }

        avatar.textContent = this.getGuildInitials(guild);
        return avatar;
    }

    getThemeValue(variableNames, fallback = "") {
        const styles = window.getComputedStyle(document.documentElement);
        for (const variableName of variableNames) {
            const value = styles.getPropertyValue(variableName).trim();
            if (value) return value;
        }

        return fallback;
    }

    parseCssColor(color) {
        if (typeof color !== "string") return null;

        const normalized = color.trim();
        const rgbMatch = normalized.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
        if (rgbMatch) {
            return rgbMatch.slice(1, 4).map((value) => Number.parseInt(value, 10));
        }

        const hexMatch = normalized.match(/^#([\da-f]{3}|[\da-f]{6}|[\da-f]{8})$/i);
        if (!hexMatch) return null;

        const hex = hexMatch[1];
        if (hex.length === 3) {
            return [...hex].map((value) => Number.parseInt(`${value}${value}`, 16));
        }

        return [0, 2, 4].map((index) => Number.parseInt(hex.slice(index, index + 2), 16));
    }

    withAlpha(color, alpha, fallback = "rgb(88, 101, 242)") {
        const rgb = this.parseCssColor(color) ?? this.parseCssColor(fallback);
        if (!rgb) return `rgba(88, 101, 242, ${alpha})`;

        return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
    }

    toOpaqueColor(color, fallback = "rgb(30, 31, 34)", alpha = 0.98) {
        const rgb = this.parseCssColor(color) ?? this.parseCssColor(fallback);
        if (!rgb) return `rgba(30, 31, 34, ${alpha})`;

        return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
    }

    createGuildPicker(guilds) {
        const wrapper = document.createElement("div");
        wrapper.style.display = "flex";
        wrapper.style.flexDirection = "column";
        wrapper.style.gap = "8px";

        const title = document.createElement("div");
        title.textContent = "Servers";
        title.style.fontWeight = "600";

        const description = document.createElement("div");
        description.textContent = "Search and select the servers that should follow the mode above. Direct messages and group DMs are not configured from this list.";
        description.style.fontSize = "12px";
        description.style.opacity = "0.7";
        description.style.marginBottom = "4px";

        wrapper.append(title, description);

        if (!guilds.length) {
            const empty = document.createElement("div");
            empty.textContent = "No servers could be loaded.";
            empty.style.fontSize = "13px";
            empty.style.opacity = "0.7";
            wrapper.append(empty);
            return wrapper;
        }

        const picker = document.createElement("div");
        picker.style.display = "flex";
        picker.style.flexDirection = "column";
        picker.style.gap = "8px";

        const control = document.createElement("div");
        control.style.display = "flex";
        control.style.flexDirection = "column";
        control.style.gap = "10px";
        control.style.padding = "10px";
        control.style.borderRadius = "10px";
        control.style.background = "var(--background-tertiary)";
        control.style.border = "1px solid var(--background-modifier-accent)";
        control.style.cursor = "text";

        const tags = document.createElement("div");
        tags.style.display = "flex";
        tags.style.flexWrap = "wrap";
        tags.style.gap = "6px";
        tags.style.alignItems = "center";
        tags.style.minHeight = "24px";

        const input = document.createElement("input");
        input.type = "text";
        input.placeholder = "Search servers...";
        input.autocomplete = "off";
        input.style.width = "100%";
        input.style.border = "none";
        input.style.outline = "none";
        input.style.background = "transparent";
        input.style.color = "var(--text-normal)";
        input.style.font = "inherit";
        input.style.padding = "0";

        const helper = document.createElement("div");
        helper.style.fontSize = "12px";
        helper.style.opacity = "0.7";

        const list = document.createElement("div");
        list.style.display = "none";
        list.style.flexDirection = "column";
        list.style.gap = "6px";
        list.style.maxHeight = "240px";
        list.style.overflowY = "auto";
        list.style.padding = "6px";
        list.style.borderRadius = "10px";
        list.style.border = "1px solid var(--background-modifier-accent)";
        list.style.background = "var(--background-secondary)";

        control.append(tags, input);
        picker.append(control, helper, list);
        wrapper.append(picker);

        let query = "";
        let isOpen = false;
        let activeIndex = 0;
        const accentColor = this.getThemeValue(["--brand-experiment", "--brand-500", "--text-link"], "rgb(88, 101, 242)");
        const accentSoft = this.withAlpha(accentColor, 0.16);
        const accentMedium = this.withAlpha(accentColor, 0.22);
        const accentStrong = this.withAlpha(accentColor, 0.28);
        const accentBorder = this.withAlpha(accentColor, 0.55);
        const accentRing = this.withAlpha(accentColor, 0.65);
        const optionInset = this.withAlpha(this.getThemeValue(["--white-500"], "rgb(255, 255, 255)"), 0.03, "rgb(255, 255, 255)");
        const selectedBadgeText = this.getThemeValue(["--header-primary", "--text-normal"], "var(--text-normal)");

        const getSelectedGuilds = () => guilds.filter((guild) => this.settings.guildIds.includes(guild.id));
        const getFilteredGuilds = () => {
            const normalizedQuery = query.trim().toLowerCase();
            const filteredGuilds = guilds.filter((guild) => {
                const guildName = `${guild.name || ""} ${guild.id}`.toLowerCase();
                return normalizedQuery.length === 0 || guildName.includes(normalizedQuery);
            });

            return filteredGuilds.sort((left, right) => {
                const leftSelected = this.settings.guildIds.includes(left.id);
                const rightSelected = this.settings.guildIds.includes(right.id);
                if (leftSelected === rightSelected) return 0;
                return leftSelected ? -1 : 1;
            });
        };

        const removeSelectedGuild = (guildId) => {
            this.toggleGuild(guildId, false);
            render();
            input.focus();
        };

        const renderTags = () => {
            tags.replaceChildren();

            const selectedGuilds = getSelectedGuilds();
            helper.textContent = selectedGuilds.length
                ? `${selectedGuilds.length} server${selectedGuilds.length === 1 ? "" : "s"} selected. Click a tag or a selected result to remove it.`
                : "Search for a server to add it to this rule.";

            if (!selectedGuilds.length) {
                const placeholder = document.createElement("span");
                placeholder.textContent = "No servers selected yet.";
                placeholder.style.fontSize = "12px";
                placeholder.style.opacity = "0.65";
                tags.append(placeholder);
                return;
            }

            for (const guild of selectedGuilds) {
                const tag = document.createElement("div");
                tag.style.display = "inline-flex";
                tag.style.alignItems = "center";
                tag.style.gap = "6px";
                tag.style.maxWidth = "100%";
                tag.style.padding = "5px 8px";
                tag.style.borderRadius = "999px";
                tag.style.background = "var(--background-secondary)";
                tag.style.border = "1px solid var(--background-modifier-accent)";
                tag.style.cursor = "pointer";
                tag.style.transition = "background 120ms ease, border-color 120ms ease";
                tag.tabIndex = 0;
                tag.setAttribute("role", "button");
                tag.setAttribute("aria-label", `Remove ${guild.name || guild.id}`);

                const avatar = this.createGuildAvatar(guild, 18);

                const name = document.createElement("span");
                name.textContent = guild.name || guild.id;
                name.style.whiteSpace = "nowrap";
                name.style.overflow = "hidden";
                name.style.textOverflow = "ellipsis";

                const setTagStyle = (hovered) => {
                    tag.style.background = hovered ? accentSoft : "var(--background-secondary)";
                    tag.style.borderColor = hovered ? accentBorder : "var(--background-modifier-accent)";
                };

                setTagStyle(false);
                tag.addEventListener("mouseenter", () => setTagStyle(true));
                tag.addEventListener("mouseleave", () => setTagStyle(false));
                tag.addEventListener("focus", () => setTagStyle(true));
                tag.addEventListener("blur", () => setTagStyle(false));
                tag.addEventListener("click", () => {
                    removeSelectedGuild(guild.id);
                });
                tag.addEventListener("keydown", (event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;

                    event.preventDefault();
                    removeSelectedGuild(guild.id);
                });

                const remove = document.createElement("button");
                remove.type = "button";
                remove.textContent = "x";
                remove.style.border = "none";
                remove.style.background = "transparent";
                remove.style.color = "var(--text-muted)";
                remove.style.cursor = "pointer";
                remove.style.padding = "0";
                remove.style.font = "inherit";
                remove.addEventListener("click", (event) => {
                    event.stopPropagation();
                    removeSelectedGuild(guild.id);
                });

                tag.append(avatar, name, remove);
                tags.append(tag);
            }
        };

        const renderList = () => {
            if (!isOpen) {
                list.style.display = "none";
                list.replaceChildren();
                return;
            }

            const filteredGuilds = getFilteredGuilds();
            list.style.display = "flex";
            list.replaceChildren();

            if (!filteredGuilds.length) {
                const empty = document.createElement("div");
                empty.textContent = "No servers found.";
                empty.style.fontSize = "13px";
                empty.style.opacity = "0.7";
                empty.style.padding = "8px 10px";
                list.append(empty);
                return;
            }

            activeIndex = Math.max(0, Math.min(activeIndex, filteredGuilds.length - 1));

            for (const [index, guild] of filteredGuilds.entries()) {
                const isSelected = this.settings.guildIds.includes(guild.id);
                const isActive = index === activeIndex;
                const option = document.createElement("button");
                option.type = "button";
                option.style.display = "flex";
                option.style.alignItems = "center";
                option.style.justifyContent = "space-between";
                option.style.gap = "12px";
                option.style.padding = "10px";
                option.style.border = isSelected ? `1px solid ${accentBorder}` : "1px solid transparent";
                option.style.borderRadius = "8px";
                option.style.background = isSelected
                    ? (isActive ? accentStrong : accentSoft)
                    : (isActive ? "var(--background-modifier-hover)" : "transparent");
                option.style.color = "var(--text-normal)";
                option.style.cursor = "pointer";
                option.style.textAlign = "left";
                option.style.font = "inherit";
                option.style.boxShadow = isSelected ? `inset 0 0 0 1px ${optionInset}` : "none";
                option.style.transition = "background 120ms ease, border-color 120ms ease";

                const left = document.createElement("span");
                left.style.display = "flex";
                left.style.alignItems = "center";
                left.style.gap = "10px";
                left.style.flex = "1";
                left.style.minWidth = "0";

                const avatar = this.createGuildAvatar(guild, 24);
                avatar.style.boxShadow = isSelected ? `0 0 0 1px ${accentRing}` : "none";

                const label = document.createElement("span");
                label.textContent = guild.name || guild.id;
                label.style.flex = "1";
                label.style.minWidth = "0";
                label.style.overflow = "hidden";
                label.style.textOverflow = "ellipsis";
                label.style.whiteSpace = "nowrap";
                label.style.fontWeight = isSelected ? "600" : "500";

                const badge = document.createElement("span");
                badge.textContent = isSelected ? "Selected" : "+";
                badge.style.display = "inline-flex";
                badge.style.alignItems = "center";
                badge.style.justifyContent = "center";
                badge.style.opacity = isSelected ? "1" : "0.75";

                if (isSelected) {
                    badge.style.padding = "4px 8px";
                    badge.style.borderRadius = "999px";
                    badge.style.background = accentMedium;
                    badge.style.color = selectedBadgeText;
                    badge.style.fontSize = "11px";
                    badge.style.fontWeight = "700";
                    badge.style.letterSpacing = "0.02em";
                }
                else {
                    badge.style.minWidth = "18px";
                    badge.style.color = "var(--interactive-muted)";
                    badge.style.fontSize = "18px";
                }

                option.addEventListener("mousedown", (event) => {
                    event.preventDefault();
                });
                option.addEventListener("click", () => {
                    this.toggleGuild(guild.id, !isSelected);
                    query = "";
                    input.value = "";
                    activeIndex = 0;
                    isOpen = true;
                    render();
                    input.focus();
                });

                left.append(avatar, label);
                option.append(left, badge);
                list.append(option);
            }
        };

        const render = () => {
            renderTags();
            renderList();
        };

        const setPickerFocused = (focused) => {
            control.style.borderColor = focused ? "var(--text-link)" : "var(--background-modifier-accent)";
            control.style.boxShadow = focused ? "0 0 0 1px var(--text-link)" : "none";
        };

        control.addEventListener("click", () => {
            isOpen = true;
            renderList();
            input.focus();
        });

        input.addEventListener("focus", () => {
            isOpen = true;
            setPickerFocused(true);
            renderList();
        });

        input.addEventListener("input", () => {
            query = input.value;
            activeIndex = 0;
            isOpen = true;
            renderList();
        });

        input.addEventListener("keydown", (event) => {
            const filteredGuilds = getFilteredGuilds();

            if (event.key === "ArrowDown" && filteredGuilds.length) {
                event.preventDefault();
                isOpen = true;
                activeIndex = Math.min(activeIndex + 1, filteredGuilds.length - 1);
                renderList();
                return;
            }

            if (event.key === "ArrowUp" && filteredGuilds.length) {
                event.preventDefault();
                isOpen = true;
                activeIndex = Math.max(activeIndex - 1, 0);
                renderList();
                return;
            }

            if (event.key === "Enter" && isOpen && filteredGuilds.length) {
                event.preventDefault();
                const guild = filteredGuilds[activeIndex];
                const isSelected = this.settings.guildIds.includes(guild.id);
                this.toggleGuild(guild.id, !isSelected);
                query = "";
                input.value = "";
                activeIndex = 0;
                render();
                return;
            }

            if (event.key === "Escape") {
                event.preventDefault();
                isOpen = false;
                renderList();
                input.blur();
                return;
            }

            if (event.key === "Backspace" && query.length === 0) {
                const selectedGuilds = getSelectedGuilds();
                const lastGuild = selectedGuilds[selectedGuilds.length - 1];
                if (!lastGuild) return;

                this.toggleGuild(lastGuild.id, false);
                render();
            }
        });

        wrapper.addEventListener("focusout", () => {
            window.setTimeout(() => {
                const isInsideWrapper = wrapper.contains(document.activeElement);
                if (isInsideWrapper) return;

                isOpen = false;
                setPickerFocused(false);
                renderList();
            }, 0);
        });

        render();
        return wrapper;
    }

    createNativeModeSettingsPanel() {
        if (typeof BdApi?.UI?.buildSettingsPanel !== "function") return null;

        return BdApi.UI.buildSettingsPanel({
            settings: [
                {
                    type: "dropdown",
                    id: "mode",
                    name: "Reply behavior by selected servers",
                    note: "Choose whether checked servers are excluded from the plugin or are the only servers where it applies.",
                    value: this.settings.mode,
                    options: [
                        { label: "Exclude checked servers", value: "exclude" },
                        { label: "Only apply on checked servers", value: "include" }
                    ]
                }
            ],
            onChange: (firstArg, secondArg, thirdArg) => {
                const settingId = thirdArg === undefined ? firstArg : secondArg;
                const value = thirdArg === undefined ? secondArg : thirdArg;
                if (settingId !== "mode") return;

                this.settings.mode = value === "include" ? "include" : "exclude";
                this.saveSettings();
            }
        });
    }

    createGuildPickerHost(guilds) {
        const React = this.api.React;
        const plugin = this;

        return function GuildPickerHost() {
            const containerRef = React.useRef(null);

            React.useEffect(() => {
                const container = containerRef.current;
                if (!container) return undefined;

                container.replaceChildren(plugin.createGuildPicker(guilds));

                return () => {
                    container.replaceChildren();
                };
            }, []);

            return React.createElement(
                "div",
                {
                    style: {
                        marginTop: "20px"
                    }
                },
                React.createElement("div", { ref: containerRef })
            );
        };
    }

    createNativeSettingsPanel(guilds) {
        const React = this.api.React;
        const nativePanel = this.createNativeModeSettingsPanel();
        if (!nativePanel) return null;

        const GuildPickerHost = this.createGuildPickerHost(guilds);
        return React.createElement(React.Fragment, null, nativePanel, React.createElement(GuildPickerHost));
    }

    getSettingsPanel() {
        this.settings = this.loadSettings();
        const guilds = this.getGuilds();
        return this.createNativeSettingsPanel(guilds);
    }

    start() {
        this.settings = this.loadSettings();

        if (!this.replyBar) {
            console.error(`${this.meta.name}: Unable to start because the reply bar module could not be found.`);
            return;
        }

        const { Patcher } = this.api;
        Patcher.before(...this.replyBar, (_thisArg, [props]) => {
            if (!props || typeof props !== "object") return;

            const guildId = this.getCurrentGuildId(props);
            if (!this.shouldDisableMention(guildId)) return;

            props.shouldMention = false;
        });
    }

    stop() {
        const { Patcher } = this.api;
        Patcher.unpatchAll();
    }
};
