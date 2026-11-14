"""List / selectively extract archives via system libarchive (ctypes). Untrusted input:
only basenames are used, only regular files matching a suffix are written."""
import ctypes, ctypes.util, os, sys
la = ctypes.CDLL('libarchive.so.13')
la.archive_read_new.restype = ctypes.c_void_p
la.archive_entry_pathname_utf8.restype = ctypes.c_char_p
la.archive_entry_pathname.restype = ctypes.c_char_p
la.archive_entry_size.restype = ctypes.c_int64
la.archive_error_string.restype = ctypes.c_char_p
la.archive_read_data.restype = ctypes.c_ssize_t
for f in ('archive_read_support_format_all','archive_read_support_filter_all','archive_read_open_filename','archive_read_next_header','archive_read_data','archive_read_free','archive_entry_pathname_utf8','archive_entry_pathname','archive_entry_size','archive_entry_filetype','archive_error_string','archive_read_data_skip'):
    getattr(la,f).argtypes = None
def walk(path, want=None, outdir=None):
    a = ctypes.c_void_p(la.archive_read_new())
    la.archive_read_support_format_all(a); la.archive_read_support_filter_all(a)
    if la.archive_read_open_filename(a, path.encode(), ctypes.c_size_t(1<<20)) != 0:
        raise SystemExit('open failed: %r' % la.archive_error_string(a))
    e = ctypes.c_void_p(); out = []
    buf = ctypes.create_string_buffer(1<<20)
    while True:
        r = la.archive_read_next_header(a, ctypes.byref(e))
        if r == 1: break
        if r < -20: raise SystemExit('header err: %r' % la.archive_error_string(a))
        name = (la.archive_entry_pathname_utf8(e) or la.archive_entry_pathname(e) or b'').decode('utf8','replace')
        size = la.archive_entry_size(e); ftype = la.archive_entry_filetype(e)
        out.append((name, size))
        if want and outdir and ftype == 0o100000 and name in want:
            dst = os.path.join(outdir, os.path.basename(name.replace('\\','/')))
            with open(dst, 'wb') as fh:
                while True:
                    n = la.archive_read_data(a, buf, ctypes.c_size_t(len(buf)))
                    if n < 0: raise SystemExit('data err: %r' % la.archive_error_string(a))
                    if n == 0: break
                    fh.write(buf.raw[:n])
        else:
            la.archive_read_data_skip(a)
    la.archive_read_free(a)
    return out
if __name__ == '__main__':
    arc = sys.argv[1]
    if len(sys.argv) == 2:
        ents = walk(arc)
        for n, s in ents: print(s, n)
        print('TOTAL', sum(s for _, s in ents), len(ents))
    else:
        outdir = sys.argv[2]; names = set(sys.argv[3:])
        os.makedirs(outdir, exist_ok=True)
        walk(arc, names, outdir)
