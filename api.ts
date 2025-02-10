export const checkHealth = async (
	baseUrl: string,
	accessToken: string
): Promise<{ data: boolean; msg: string }> => {
	const controller = new AbortController();
	const signal = controller.signal;
	const timeoutId = setTimeout(() => controller.abort(), 500);

	return fetch(`${baseUrl}/health`, {
		method: "GET",
		signal,
		headers: {
			authentication: accessToken,
		},
	})
		.then((resp) => resp.json())
		.catch(() => ({
			data: false,
		}))
		.finally(() => clearTimeout(timeoutId));
};

export const sync = async (
	baseUrl: string,
	accessToken: string,
	formData: FormData
) => {
	return fetch(`${baseUrl}`, {
		method: "POST",
		headers: {
			authentication: accessToken,
		},
		body: formData,
	}).then((resp) => resp.json());
};

export const flush = async (baseUrl: string, accessToken: string) => {
	return fetch(`${baseUrl}/flush`, {
		method: "GET",
		headers: {
			authentication: accessToken,
		},
	}).then((resp) => resp.json());
};

export const rebuild = async (
	baseUrl: string,
	accessToken: string,
	body: {
		files: {
			path: string;
			md5: string;
			extension: string;
			lastModified: string;
		}[];
		clearOthers: boolean;
	}
) => {
	return fetch(`${baseUrl}/rebuild`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			authentication: accessToken,
		},
		body: JSON.stringify(body),
	}).then((resp) => resp.json());
};
