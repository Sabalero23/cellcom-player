export const klv_parse = (data) => {
    const result = [];
    let offset = 0;
    while (offset + 5 < data.byteLength) {
        const service_id = data[offset + 0];
        const sequence_number = data[offset + 1];
        const flags = data[offset + 2];
        const au_size = (data[offset + 3] << 8) | (data[offset + 4] << 0);
        const au_data = data.slice(offset + 5, offset + 5 + au_size);
        result.push({
            service_id,
            sequence_number,
            flags,
            data: au_data
        });
        offset += 5 + au_size;
    }
    return result;
};
