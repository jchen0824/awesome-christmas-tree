export const getAssetPath = (path: string): string => {
    // Remove leading slash if present to avoid double slashes with BASE_URL
    const cleanPath = path.startsWith('/') ? path.slice(1) : path;
    return import.meta.env.BASE_URL + cleanPath;
};
