export const check = (baseUrl: string, md5: string): Promise<{
	data: {
		exists: boolean
	};
	msg: string;
}> => {
	return fetch(`${baseUrl}/check?md5=${md5}`, {
		method: "GET",
	}).then(resp => resp.json());
}

export const sync = (baseUrl: string, formData: FormData) => {
	return fetch(`${baseUrl}`, {
		method: 'POST',
		body: formData
	}).then(resp => resp.json());
}
