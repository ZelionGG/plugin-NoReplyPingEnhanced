/**
 * @name NoReplyPingEnhanced
 * @description Automatically sets replies to not ping the target, with per-server include/exclude options.
 * @author ZelionGG
 * @authorId
 * @authorLink https://github.com/ZelionGG/
 * @version 1.0
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
            userIds: [],
            applyInDms: false
        };
        this.settings = this.loadSettings();

        const { Filters } = this.api.Webpack;
        this.pendingReplyBinding = this.findWebpackBinding(Filters.byStrings('type:"CREATE_PENDING_REPLY"'));
        this.guildStore = this.api.Webpack.getModule((module) => typeof module?.getGuilds === "function", { searchExports: true })
            ?? this.api.Webpack.getModule((module) => typeof module?.getGuild === "function", { searchExports: true });
        this.selectedGuildStore = this.api.Webpack.getModule((module) => typeof module?.getGuildId === "function", { searchExports: true });
        this.userStore = this.api.Webpack.getModule(
            (module) => typeof module?.getUser === "function" && typeof module?.getCurrentUser === "function",
            { searchExports: true }
        );
        this.imageResolver = this.api.Webpack.getModule(
            (module) => typeof module?.getUserAvatarURL === "function" && typeof module?.getGuildIconURL === "function",
            { searchExports: true }
        ) ?? this.api.Webpack.getModule(
            (module) => typeof module?.getUserAvatarURL === "function",
            { searchExports: true }
        );
    }

    findWebpackBinding(filter) {
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
            guildIds: this.normalizeGuildIds(saved?.guildIds),
            userIds: this.normalizeUserIds(saved?.userIds ?? saved?.userId)
        };

        return {
            ...settings,
            mode: settings.mode === "include" ? "include" : "exclude",
            applyInDms: Boolean(settings.applyInDms)
        };
    }

    saveSettings() {
        this.settings.guildIds = this.normalizeGuildIds(this.settings.guildIds);
        this.settings.userIds = this.normalizeUserIds(this.settings.userIds);
        BdApi.Data.save(this.meta.name, "settings", this.settings);
    }

    normalizeGuildIds(guildIds) {
        if (!Array.isArray(guildIds)) return [];

        return [...new Set(guildIds.filter((guildId) => typeof guildId === "string" && guildId.length > 0))];
    }

    normalizeUserId(userId) {
        return typeof userId === "string" && userId.length > 0 ? userId : null;
    }

    normalizeUserIds(userIds) {
        if (Array.isArray(userIds)) {
            return [...new Set(userIds.map((userId) => this.normalizeUserId(userId)).filter(Boolean))];
        }

        const singleUserId = this.normalizeUserId(userIds);
        return singleUserId ? [singleUserId] : [];
    }

    isLikelyDiscordUserId(userId) {
        return /^\d{17,20}$/.test((userId || "").trim());
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

    getCurrentUserId() {
        const currentUserId = this.userStore?.getCurrentUser?.()?.id;
        return typeof currentUserId === "string" && currentUserId.length > 0 ? currentUserId : null;
    }

    getStringAtPath(target, path) {
        let value = target;
        for (const key of path) {
            value = value?.[key];
        }

        return typeof value === "string" && value.length > 0 ? value : null;
    }

    findNestedReplyTargetUserId(target, currentUserId) {
        const queue = [{ value: target, depth: 0 }];
        const visited = new Set();
        const candidateUserIds = [];
        let inspectedNodes = 0;

        while (queue.length && inspectedNodes < 300) {
            const { value, depth } = queue.shift();
            if (!value || typeof value !== "object") continue;
            if (visited.has(value)) continue;

            visited.add(value);
            inspectedNodes += 1;

            const authorId = value?.author?.id;
            if (typeof authorId === "string" && authorId.length > 0) {
                candidateUserIds.push(authorId);
            }

            if (depth >= 4) continue;

            for (const childValue of Object.values(value)) {
                if (!childValue || typeof childValue !== "object") continue;
                queue.push({ value: childValue, depth: depth + 1 });
            }
        }

        const uniqueUserIds = [...new Set(candidateUserIds)];
        const nonSelfUserIds = uniqueUserIds.filter((userId) => userId !== currentUserId);
        if (nonSelfUserIds.length === 1) return nonSelfUserIds[0];
        if (!nonSelfUserIds.length && uniqueUserIds.length === 1) return uniqueUserIds[0];

        return null;
    }

    getTargetUserIdFromProps(props) {
        const preferredPaths = [
            ["baseMessage", "author", "id"],
            ["referencedMessage", "author", "id"],
            ["message", "referencedMessage", "author", "id"],
            ["reply", "message", "author", "id"],
            ["pendingReply", "message", "author", "id"],
            ["pendingReply", "author", "id"],
            ["item", "author", "id"],
            ["message", "message", "author", "id"]
        ];

        for (const path of preferredPaths) {
            const userId = this.getStringAtPath(props, path);
            if (userId) return userId;
        }

        return this.findNestedReplyTargetUserId(props, this.getCurrentUserId());
    }

    shouldDisableMention(guildId, targetUserId = null) {
        if (targetUserId && this.settings.userIds.includes(targetUserId)) {
            return true;
        }

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

    addUserFilter(userId) {
        const normalizedUserId = this.normalizeUserId(userId);
        if (!normalizedUserId) return;

        const userIds = new Set(this.settings.userIds);
        userIds.add(normalizedUserId);
        this.settings.userIds = [...userIds];
        this.saveSettings();
        window.dispatchEvent(new CustomEvent(`${this.meta.name}:settings-view-update`));
    }

    removeUserFilter(userId) {
        const normalizedUserId = this.normalizeUserId(userId);
        if (!normalizedUserId) return;

        this.settings.userIds = this.settings.userIds.filter((currentUserId) => currentUserId !== normalizedUserId);
        this.saveSettings();
        window.dispatchEvent(new CustomEvent(`${this.meta.name}:settings-view-update`));
    }

    getFilteredUsers() {
        return this.settings.userIds.map((userId) => ({
            id: userId,
            user: this.userStore?.getUser?.(userId) ?? null
        }));
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

    getUserDisplayName(user) {
        if (!user || typeof user !== "object") return "Unknown user";

        const username = typeof user.username === "string" && user.username.length > 0
            ? user.username
            : user.id;
        const discriminator = typeof user.discriminator === "string" ? user.discriminator : "";

        if (!discriminator || discriminator === "0") return username;
        return `${username}#${discriminator}`;
    }

    getUserAvatarUrl(user) {
        if (!user || typeof user !== "object") return null;

        try {
            if (typeof user.getAvatarURL === "function") {
                const avatarUrl = user.getAvatarURL(64, false);
                if (typeof avatarUrl === "string" && avatarUrl.length > 0) return avatarUrl;
            }
        }
        catch {
            // Ignore and fall back to the image resolver.
        }

        try {
            if (typeof this.imageResolver?.getUserAvatarURL === "function") {
                const avatarUrl = this.imageResolver.getUserAvatarURL(user);
                if (typeof avatarUrl === "string" && avatarUrl.length > 0) {
                    return user.avatar ? avatarUrl : `${window.location.origin}${avatarUrl}`;
                }
            }
        }
        catch {
            // Ignore and fall back to initials.
        }

        const avatarHash = typeof user.avatar === "string" && user.avatar.length > 0 ? user.avatar : null;
        if (!avatarHash || typeof user.id !== "string" || user.id.length === 0) return null;

        const extension = avatarHash.startsWith("a_") ? "gif" : "png";
        return `https://cdn.discordapp.com/avatars/${user.id}/${avatarHash}.${extension}?size=64`;
    }

    getUserInitials(user) {
        const label = this.getUserDisplayName(user).trim();
        if (!label) return "?";

        const parts = label.split(/\s+/).filter(Boolean);
        if (!parts.length) return label.slice(0, 2).toUpperCase();

        return parts.slice(0, 2).map((part) => part[0]).join("").toUpperCase();
    }

    createUserAvatar(user, size = 28) {
        const avatar = document.createElement("span");
        avatar.style.width = `${size}px`;
        avatar.style.height = `${size}px`;
        avatar.style.flex = "0 0 auto";
        avatar.style.display = "inline-flex";
        avatar.style.alignItems = "center";
        avatar.style.justifyContent = "center";
        avatar.style.overflow = "hidden";
        avatar.style.borderRadius = "50%";
        avatar.style.background = this.withAlpha(this.getThemeValue(["--brand-experiment", "--brand-500", "--text-link"], "rgb(88, 101, 242)"), 0.22);
        avatar.style.color = this.getThemeValue(["--header-primary", "--text-normal"], "#ffffff");
        avatar.style.fontSize = `${Math.max(11, Math.floor(size / 2.4))}px`;
        avatar.style.fontWeight = "700";
        avatar.style.lineHeight = "1";
        avatar.style.textTransform = "uppercase";
        const avatarUrl = this.getUserAvatarUrl(user);
        if (avatarUrl) {
            const image = document.createElement("img");
            image.src = avatarUrl;
            image.alt = "";
            image.width = size;
            image.height = size;
            image.style.width = "100%";
            image.style.height = "100%";
            image.style.objectFit = "cover";
            image.addEventListener("error", () => {
                avatar.replaceChildren(this.getUserInitials(user));
            }, { once: true });
            avatar.append(image);
            return avatar;
        }

        avatar.textContent = this.getUserInitials(user);
        return avatar;
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

    createUserPicker() {
        const wrapper = document.createElement("div");
        wrapper.style.display = "flex";
        wrapper.style.flexDirection = "column";
        wrapper.style.gap = "8px";
        wrapper.style.marginTop = "20px";

        const title = document.createElement("div");
        title.textContent = "Users";
        title.style.fontWeight = "600";

        const description = document.createElement("div");
        description.textContent = "Add one Discord user ID if you always want replies to that user to avoid pinging them.";
        description.style.fontSize = "12px";
        description.style.opacity = "0.7";
        description.style.marginBottom = "4px";

        const helper = document.createElement("div");
        helper.style.padding = "12px";
        helper.style.borderRadius = "10px";
        helper.style.background = "var(--background-tertiary)";
        helper.style.border = "1px solid var(--background-modifier-accent)";
        helper.style.fontSize = "12px";
        helper.style.lineHeight = "1.45";
        helper.style.color = "var(--text-normal)";
        helper.textContent = "How to get a User ID: enable Discord Developer Mode in User Settings > Advanced, then right-click the user and choose Copy User ID. Paste a numeric ID. This user rule is combined with the server rule using OR: if the replied user matches this ID, the mention is disabled even if the server rule would normally allow it. If Discord already has that user in local cache, their name and avatar will be shown automatically.";

        const body = document.createElement("div");
        body.style.display = "flex";
        body.style.flexDirection = "column";
        body.style.gap = "8px";

        const control = document.createElement("div");
        control.style.display = "flex";
        control.style.flexDirection = "column";
        control.style.gap = "10px";
        control.style.padding = "10px";
        control.style.borderRadius = "10px";
        control.style.background = "var(--background-tertiary)";
        control.style.border = "1px solid var(--background-modifier-accent)";

        const selected = document.createElement("div");
        selected.style.display = "flex";
        selected.style.flexWrap = "wrap";
        selected.style.gap = "6px";
        selected.style.alignItems = "center";
        selected.style.minHeight = "24px";

        const entry = document.createElement("div");
        entry.style.display = "flex";
        entry.style.flexDirection = "column";
        entry.style.gap = "8px";

        const inputRow = document.createElement("div");
        inputRow.style.display = "flex";
        inputRow.style.gap = "8px";
        inputRow.style.alignItems = "stretch";

        const input = document.createElement("input");
        input.type = "text";
        input.inputMode = "numeric";
        input.placeholder = "Paste a Discord User ID...";
        input.autocomplete = "off";
        input.spellcheck = false;
        input.style.flex = "1";
        input.style.minWidth = "0";
        input.style.padding = "10px 12px";
        input.style.borderRadius = "8px";
        input.style.border = "1px solid var(--background-modifier-accent)";
        input.style.background = "var(--background-secondary)";
        input.style.color = "var(--text-normal)";
        input.style.font = "inherit";
        input.style.outline = "none";

        const addButton = document.createElement("button");
        addButton.type = "button";
        addButton.textContent = "Add";
        addButton.style.border = "none";
        addButton.style.borderRadius = "8px";
        addButton.style.padding = "0 14px";
        addButton.style.background = "var(--button-filled-brand-background, var(--brand-experiment, var(--brand-500)))";
        addButton.style.color = "var(--white-500, #ffffff)";
        addButton.style.font = "inherit";
        addButton.style.fontWeight = "600";
        addButton.style.cursor = "pointer";
        addButton.style.minWidth = "84px";

        const entryStatus = document.createElement("div");
        entryStatus.style.fontSize = "12px";
        entryStatus.style.lineHeight = "1.4";

        const selection = document.createElement("div");
        selection.style.display = "flex";
        selection.style.flexDirection = "column";
        selection.style.gap = "8px";

        const accentColor = this.getThemeValue(["--brand-experiment", "--brand-500", "--text-link"], "rgb(88, 101, 242)");
        const accentSoft = this.withAlpha(accentColor, 0.12);
        const accentBorder = this.withAlpha(accentColor, 0.45);
        let draftUserId = "";

        const getUserBehaviorText = () => "Replies to these users will never ping them. This is an extra no-ping rule layered on top of the server configuration.";

        const updateInputState = () => {
            const trimmedUserId = draftUserId.trim();
            const hasValue = trimmedUserId.length > 0;
            const isValid = this.isLikelyDiscordUserId(trimmedUserId);

            addButton.disabled = !isValid;
            addButton.style.opacity = isValid ? "1" : "0.55";
            addButton.style.cursor = isValid ? "pointer" : "not-allowed";
            control.style.borderColor = hasValue && !isValid
                ? "var(--status-danger, #f23f43)"
                : "var(--background-modifier-accent)";
            input.style.borderColor = hasValue && !isValid
                ? "var(--status-danger, #f23f43)"
                : "var(--background-modifier-accent)";

            if (!hasValue) {
                entryStatus.textContent = "Only numeric Discord user IDs are accepted. Each added user stays active even if Discord has not resolved them in local cache yet.";
                entryStatus.style.color = "var(--text-muted)";
                return;
            }

            if (!isValid) {
                entryStatus.textContent = "That does not look like a Discord User ID. Paste a numeric snowflake copied from Discord Developer Mode.";
                entryStatus.style.color = "var(--status-danger, #f23f43)";
                return;
            }

            if (this.settings.userIds.includes(trimmedUserId)) {
                entryStatus.textContent = "That user is already in the no-ping list.";
                entryStatus.style.color = "var(--text-muted)";
                return;
            }

            entryStatus.textContent = "Press Add to store this user no-ping rule. If either the user rule or the server rule matches, the mention will be disabled.";
            entryStatus.style.color = "var(--text-muted)";
        };

        const submitUserId = () => {
            const trimmedUserId = draftUserId.trim();
            if (!this.isLikelyDiscordUserId(trimmedUserId)) {
                updateInputState();
                input.focus();
                return;
            }

            if (this.settings.userIds.includes(trimmedUserId)) {
                updateInputState();
                input.focus();
                return;
            }

            this.addUserFilter(trimmedUserId);
            draftUserId = "";
            input.value = "";
            updateInputState();
            renderSelection();
        };

        const renderSelection = () => {
            selected.replaceChildren();
            selection.replaceChildren();

            const filteredUsers = this.getFilteredUsers();
            if (!filteredUsers.length) {
                const empty = document.createElement("div");
                empty.textContent = "No user selected yet.";
                empty.style.fontSize = "12px";
                empty.style.opacity = "0.65";
                selected.append(empty);

                const hint = document.createElement("div");
                hint.textContent = "Add a Discord User ID above if you always want replies to that user to avoid pinging them.";
                hint.style.fontSize = "12px";
                hint.style.opacity = "0.7";
                selection.append(hint);
                return;
            }

            const detail = document.createElement("div");
            detail.style.fontSize = "12px";
            detail.style.opacity = "0.75";
            detail.textContent = `${filteredUsers.length} user${filteredUsers.length === 1 ? "" : "s"} selected. ${getUserBehaviorText()}`;

            for (const { id, user } of filteredUsers) {
                const chip = document.createElement("div");
                chip.style.display = "inline-flex";
                chip.style.alignItems = "center";
                chip.style.gap = "6px";
                chip.style.maxWidth = "100%";
                chip.style.padding = "5px 8px";
                chip.style.borderRadius = "999px";
                chip.style.background = "var(--background-secondary)";
                chip.style.border = `1px solid ${accentBorder}`;
                chip.style.cursor = "pointer";
                chip.style.transition = "background 120ms ease, border-color 120ms ease";
                chip.tabIndex = 0;
                chip.setAttribute("role", "button");
                chip.setAttribute("aria-label", `Remove ${user ? this.getUserDisplayName(user) : id}`);

                const avatar = this.createUserAvatar(user ?? { id, username: id }, 30);
                avatar.style.width = "18px";
                avatar.style.height = "18px";
                avatar.style.fontSize = "10px";

                const name = document.createElement("span");
                name.textContent = user ? this.getUserDisplayName(user) : `User ID ${id}`;
                name.style.fontWeight = "500";
                name.style.whiteSpace = "nowrap";
                name.style.overflow = "hidden";
                name.style.textOverflow = "ellipsis";

                const clear = document.createElement("button");
                clear.type = "button";
                clear.textContent = "x";
                clear.style.border = "none";
                clear.style.background = "transparent";
                clear.style.color = "var(--text-muted)";
                clear.style.cursor = "pointer";
                clear.style.padding = "0";
                clear.style.font = "inherit";

                const clearUserFilter = () => {
                    this.removeUserFilter(id);
                    renderSelection();
                };

                const setChipStyle = (hovered) => {
                    chip.style.background = hovered ? accentSoft : "var(--background-secondary)";
                    chip.style.borderColor = accentBorder;
                };

                setChipStyle(false);
                chip.addEventListener("mouseenter", () => setChipStyle(true));
                chip.addEventListener("mouseleave", () => setChipStyle(false));
                chip.addEventListener("focus", () => setChipStyle(true));
                chip.addEventListener("blur", () => setChipStyle(false));
                chip.addEventListener("click", clearUserFilter);
                chip.addEventListener("keydown", (event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    clearUserFilter();
                });
                clear.addEventListener("click", (event) => {
                    event.stopPropagation();
                    clearUserFilter();
                });

                chip.append(avatar, name, clear);
                selected.append(chip);
            }

            selection.append(detail);
        };

        input.addEventListener("input", () => {
            draftUserId = input.value;
            updateInputState();
        });
        input.addEventListener("keydown", (event) => {
            if (event.key !== "Enter") return;

            event.preventDefault();
            submitUserId();
        });
        input.addEventListener("focus", () => {
            input.style.borderColor = "var(--text-link)";
            input.style.boxShadow = "0 0 0 1px var(--text-link)";
        });
        input.addEventListener("blur", () => {
            input.style.boxShadow = "none";
            updateInputState();
        });
        addButton.addEventListener("click", submitUserId);

        inputRow.append(input, addButton);
        entry.append(selected, inputRow, entryStatus);
        control.append(entry);
        body.append(helper, control, selection);

        const handleUpdate = () => {
            renderSelection();
            updateInputState();
        };
        window.addEventListener(`${this.meta.name}:settings-view-update`, handleUpdate);
        wrapper.cleanup = () => {
            window.removeEventListener(`${this.meta.name}:settings-view-update`, handleUpdate);
        };

        wrapper.append(title, description, body);
        renderSelection();
        updateInputState();
        return wrapper;
    }

    createFiltersPanel(guilds) {
        const wrapper = document.createElement("div");
        const guildPicker = this.createGuildPicker(guilds);
        const userPicker = this.createUserPicker();
        wrapper.append(guildPicker, userPicker);
        wrapper.cleanup = () => {
            if (typeof userPicker.cleanup === "function") userPicker.cleanup();
        };
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
                window.dispatchEvent(new CustomEvent(`${this.meta.name}:settings-view-update`));
            }
        });
    }

    createFiltersHost(guilds) {
        const React = this.api.React;
        const plugin = this;

        return function FiltersHost() {
            const containerRef = React.useRef(null);

            React.useEffect(() => {
                const container = containerRef.current;
                if (!container) return undefined;

                const panel = plugin.createFiltersPanel(guilds);
                container.replaceChildren(panel);

                return () => {
                    if (typeof panel.cleanup === "function") panel.cleanup();
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

        const FiltersHost = this.createFiltersHost(guilds);
        return React.createElement(React.Fragment, null, nativePanel, React.createElement(FiltersHost));
    }

    getSettingsPanel() {
        this.settings = this.loadSettings();
        const guilds = this.getGuilds();
        return this.createNativeSettingsPanel(guilds);
    }

    start() {
        this.settings = this.loadSettings();

        if (!this.pendingReplyBinding) {
            console.error(`${this.meta.name}: Unable to start because the pending reply hook could not be found.`);
            return;
        }

        const { Patcher } = this.api;
        Patcher.before(...this.pendingReplyBinding, (_thisArg, [props]) => {
            if (!props || typeof props !== "object") return;

            const guildId = this.getCurrentGuildId(props);
            const targetUserId = this.getTargetUserIdFromProps(props);
            if (!this.shouldDisableMention(guildId, targetUserId)) return;

            props.shouldMention = false;
        });
    }

    stop() {
        const { Patcher } = this.api;
        Patcher.unpatchAll();
    }
};
