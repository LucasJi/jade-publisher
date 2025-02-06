export const checkFileExists = async (baseUrl: string, md5: string): Promise<{
	data: {
		exists: boolean
	};
	msg: string;
}> => {
	return fetch(`${baseUrl}/check-file-exists?md5=${md5}`, {
		method: "GET",
	}).then(resp => resp.json());
}

export const checkHealth = async (baseUrl: string): Promise<{ data: boolean, msg: string }> => {
	return fetch(`${baseUrl}/check-health`, {
		method: "GET",
	}).then(resp => resp.json()).catch(e => ({
		data: false
	}));
}

export const sync = async (baseUrl: string, formData: FormData) => {
	return fetch(`${baseUrl}`, {
		method: 'POST',
		body: formData
	}).then(resp => resp.json());
}

export const rebuild = async (baseUrl: string, body: {
	files: {
		path: string;
		md5: string;
		extension: string;
		lastModified: string;
	}[];
	clearOthers: boolean;
}) => {
	return fetch(`${baseUrl}/rebuild`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json'
		},
		body: JSON.stringify(body),
	}).then(resp => resp.json());
}
