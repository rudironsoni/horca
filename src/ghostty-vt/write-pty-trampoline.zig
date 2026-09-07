extern "env" fn write_pty(term: u32, userdata: u32, data: u32, len: u32) void;

export fn trampoline(term: u32, userdata: u32, data: u32, len: u32) void {
    write_pty(term, userdata, data, len);
}
