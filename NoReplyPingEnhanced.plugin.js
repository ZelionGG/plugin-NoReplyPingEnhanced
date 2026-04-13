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
const fs = require("fs");
const path = require("path");

const RAW_CSS_FILENAME = "NoReplyPingEnhanced.raw.css";

module.exports = class NoReplyPingEnhanced {
    constructor(meta) {
        this.meta = meta;
        this.api = new BdApi(meta.name);
        this.styleElementId = `${meta.name}-raw-css`;
        this.styleElement = null;
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

    getRawCssCandidates() {
        const candidates = new Set();

        if (typeof BdApi?.Plugins?.folder === "string" && BdApi.Plugins.folder.length > 0) {
            candidates.add(path.join(BdApi.Plugins.folder, RAW_CSS_FILENAME));
        }

        if (typeof __dirname === "string" && __dirname.length > 0) {
            candidates.add(path.join(__dirname, RAW_CSS_FILENAME));
        }

        if (typeof this.meta?.filename === "string" && this.meta.filename.length > 0) {
            candidates.add(path.join(path.dirname(this.meta.filename), RAW_CSS_FILENAME));
        }

        return [...candidates];
    }

    getRawCssPath() {
        return this.getRawCssCandidates().find((candidatePath) => {
            try {
                return fs.existsSync(candidatePath);
            }
            catch {
                return false;
            }
        }) ?? null;
    }

    mountRawCss() {
        this.unmountRawCss();

        const cssPath = this.getRawCssPath();
        if (!cssPath) {
            console.warn(`${this.meta.name}: ${RAW_CSS_FILENAME} was not found. The plugin will continue with fallback inline styling.`);
            return;
        }

        try {
            const cssText = fs.readFileSync(cssPath, "utf8");
            if (!cssText.trim()) return;

            const styleElement = document.createElement("style");
            styleElement.id = this.styleElementId;
            styleElement.textContent = cssText;
            (document.head ?? document.documentElement).append(styleElement);
            this.styleElement = styleElement;
        }
        catch (error) {
            console.warn(`${this.meta.name}: Failed to load ${RAW_CSS_FILENAME}.`, error);
        }
    }

    unmountRawCss() {
        if (this.styleElement?.remove instanceof Function) {
            this.styleElement.remove();
        }

        this.styleElement = null;
        document.getElementById(this.styleElementId)?.remove();
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
        avatar.className = "nrpe-avatar nrpe-avatar--user";
        avatar.style.width = `${size}px`;
        avatar.style.height = `${size}px`;
        avatar.style.background = this.withAlpha(this.getThemeValue(["--brand-experiment", "--brand-500", "--text-link"], "rgb(88, 101, 242)"), 0.22);
        avatar.style.color = this.getThemeValue(["--header-primary", "--text-normal"], "#ffffff");
        avatar.style.fontSize = `${Math.max(11, Math.floor(size / 2.4))}px`;
        const avatarUrl = this.getUserAvatarUrl(user);
        if (avatarUrl) {
            const image = document.createElement("img");
            image.className = "nrpe-avatar-image";
            image.src = avatarUrl;
            image.alt = "";
            image.width = size;
            image.height = size;
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
        avatar.className = "nrpe-avatar nrpe-avatar--guild";
        avatar.style.width = `${size}px`;
        avatar.style.height = `${size}px`;
        avatar.style.background = "var(--brand-500, var(--background-accent))";
        avatar.style.color = this.getThemeValue(["--interactive-active", "--white-500"], "#ffffff");
        avatar.style.fontSize = `${Math.max(10, Math.floor(size / 2.2))}px`;

        const iconUrl = this.getGuildIconUrl(guild);
        if (iconUrl) {
            const image = document.createElement("img");
            image.className = "nrpe-avatar-image";
            image.src = iconUrl;
            image.alt = "";
            image.width = size;
            image.height = size;
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
        wrapper.className = "nrpe-section";

        const title = document.createElement("div");
        title.className = "nrpe-section-title";
        title.textContent = "Servers";

        const description = document.createElement("div");
        description.className = "nrpe-section-description";
        description.textContent = "Search and select the servers that should follow the mode above. Direct messages and group DMs are not configured from this list.";

        wrapper.append(title, description);

        if (!guilds.length) {
            const empty = document.createElement("div");
            empty.className = "nrpe-empty-text";
            empty.textContent = "No servers could be loaded.";
            wrapper.append(empty);
            return wrapper;
        }

        const picker = document.createElement("div");
        picker.className = "nrpe-picker";

        const control = document.createElement("div");
        control.className = "nrpe-picker-control";

        const tags = document.createElement("div");
        tags.className = "nrpe-picker-tags";

        const input = document.createElement("input");
        input.className = "nrpe-picker-input";
        input.type = "text";
        input.placeholder = "Search servers...";
        input.autocomplete = "off";

        const helper = document.createElement("div");
        helper.className = "nrpe-helper-text";

        const list = document.createElement("div");
        list.className = "nrpe-picker-list";

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
                placeholder.className = "nrpe-picker-placeholder";
                placeholder.textContent = "No servers selected yet.";
                tags.append(placeholder);
                return;
            }

            for (const guild of selectedGuilds) {
                const tag = document.createElement("div");
                tag.className = "nrpe-chip";
                tag.tabIndex = 0;
                tag.setAttribute("role", "button");
                tag.setAttribute("aria-label", `Remove ${guild.name || guild.id}`);

                const avatar = this.createGuildAvatar(guild, 18);

                const name = document.createElement("span");
                name.className = "nrpe-chip-label";
                name.textContent = guild.name || guild.id;

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
                remove.className = "nrpe-icon-button";
                remove.type = "button";
                remove.textContent = "x";
                remove.addEventListener("click", (event) => {
                    event.stopPropagation();
                    removeSelectedGuild(guild.id);
                });

                tag.append(avatar, name, remove);
                tags.append(tag);
            }
        };

        const renderList = () => {
            list.classList.toggle("nrpe-picker-list--open", isOpen);

            if (!isOpen) {
                list.replaceChildren();
                return;
            }

            const filteredGuilds = getFilteredGuilds();
            list.replaceChildren();

            if (!filteredGuilds.length) {
                const empty = document.createElement("div");
                empty.className = "nrpe-empty-text nrpe-empty-text--padded";
                empty.textContent = "No servers found.";
                list.append(empty);
                return;
            }

            activeIndex = Math.max(0, Math.min(activeIndex, filteredGuilds.length - 1));

            for (const [index, guild] of filteredGuilds.entries()) {
                const isSelected = this.settings.guildIds.includes(guild.id);
                const isActive = index === activeIndex;
                const option = document.createElement("button");
                option.className = "nrpe-picker-option";
                option.type = "button";
                option.style.border = isSelected ? `1px solid ${accentBorder}` : "1px solid transparent";
                option.style.background = isSelected
                    ? (isActive ? accentStrong : accentSoft)
                    : (isActive ? "var(--background-modifier-hover)" : "transparent");
                option.style.boxShadow = isSelected ? `inset 0 0 0 1px ${optionInset}` : "none";

                const left = document.createElement("span");
                left.className = "nrpe-picker-option-left";

                const avatar = this.createGuildAvatar(guild, 24);
                avatar.style.boxShadow = isSelected ? `0 0 0 1px ${accentRing}` : "none";

                const label = document.createElement("span");
                label.className = `nrpe-picker-option-label${isSelected ? " nrpe-picker-option-label--selected" : ""}`;
                label.textContent = guild.name || guild.id;

                const badge = document.createElement("span");
                badge.className = `nrpe-picker-option-badge${isSelected ? " nrpe-picker-option-badge--selected" : " nrpe-picker-option-badge--add"}`;
                badge.textContent = isSelected ? "Selected" : "+";
                badge.style.opacity = isSelected ? "1" : "0.75";

                if (isSelected) {
                    badge.style.background = accentMedium;
                    badge.style.color = selectedBadgeText;
                }
                else {
                    badge.style.color = "var(--interactive-muted)";
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
            control.classList.toggle("nrpe-picker-control--focused", focused);
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
        wrapper.className = "nrpe-section nrpe-section--spaced-top";

        const title = document.createElement("div");
        title.className = "nrpe-section-title";
        title.textContent = "Users";

        const description = document.createElement("div");
        description.className = "nrpe-section-description";
        description.textContent = "Add one Discord user ID if you always want replies to that user to avoid pinging them.";

        const helper = document.createElement("div");
        helper.className = "nrpe-user-callout";
        helper.textContent = "How to get a User ID: enable Discord Developer Mode in User Settings > Advanced, then right-click the user and choose Copy User ID. Paste a numeric ID. This user rule is combined with the server rule using OR: if the replied user matches this ID, the mention is disabled even if the server rule would normally allow it. If Discord already has that user in local cache, their name and avatar will be shown automatically.";

        const body = document.createElement("div");
        body.className = "nrpe-user-body";

        const control = document.createElement("div");
        control.className = "nrpe-picker-control nrpe-user-control";

        const selected = document.createElement("div");
        selected.className = "nrpe-picker-tags";

        const entry = document.createElement("div");
        entry.className = "nrpe-user-entry";

        const inputRow = document.createElement("div");
        inputRow.className = "nrpe-input-row";

        const input = document.createElement("input");
        input.className = "nrpe-text-input";
        input.type = "text";
        input.inputMode = "numeric";
        input.placeholder = "Paste a Discord User ID...";
        input.autocomplete = "off";
        input.spellcheck = false;

        const addButton = document.createElement("button");
        addButton.className = "nrpe-action-button";
        addButton.type = "button";
        addButton.textContent = "Add";

        const entryStatus = document.createElement("div");
        entryStatus.className = "nrpe-status-text";

        const selection = document.createElement("div");
        selection.className = "nrpe-selection";

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
                empty.className = "nrpe-picker-placeholder";
                empty.textContent = "No user selected yet.";
                selected.append(empty);

                const hint = document.createElement("div");
                hint.className = "nrpe-helper-text";
                hint.textContent = "Add a Discord User ID above if you always want replies to that user to avoid pinging them.";
                selection.append(hint);
                return;
            }

            const detail = document.createElement("div");
            detail.className = "nrpe-detail-text";
            detail.textContent = `${filteredUsers.length} user${filteredUsers.length === 1 ? "" : "s"} selected. ${getUserBehaviorText()}`;

            for (const { id, user } of filteredUsers) {
                const chip = document.createElement("div");
                chip.className = "nrpe-chip";
                chip.style.borderColor = accentBorder;
                chip.tabIndex = 0;
                chip.setAttribute("role", "button");
                chip.setAttribute("aria-label", `Remove ${user ? this.getUserDisplayName(user) : id}`);

                const avatar = this.createUserAvatar(user ?? { id, username: id }, 30);
                avatar.style.width = "18px";
                avatar.style.height = "18px";
                avatar.style.fontSize = "10px";

                const name = document.createElement("span");
                name.className = "nrpe-chip-label";
                name.textContent = user ? this.getUserDisplayName(user) : `User ID ${id}`;

                const clear = document.createElement("button");
                clear.className = "nrpe-icon-button";
                clear.type = "button";
                clear.textContent = "x";

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
            input.classList.add("nrpe-text-input--focused");
        });
        input.addEventListener("blur", () => {
            input.classList.remove("nrpe-text-input--focused");
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
                    className: "nrpe-filters-host"
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
        this.mountRawCss();

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
        this.unmountRawCss();
        const { Patcher } = this.api;
        Patcher.unpatchAll();
    }
};
