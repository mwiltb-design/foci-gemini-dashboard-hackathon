#define _GNU_SOURCE
#include <stdio.h>
#include <errno.h>
#include <dlfcn.h>
#include <sys/stat.h>

static int (*real_chmod)(const char *path, mode_t mode) = NULL;
static int (*real_fchmod)(int fd, mode_t mode) = NULL;
static int (*real_fchmodat)(int dirfd, const char *pathname, mode_t mode, int flags) = NULL;

int chmod(const char *path, mode_t mode) {
    if (!real_chmod) real_chmod = (int (*)(const char *, mode_t))dlsym(RTLD_NEXT, "chmod");
    int res = real_chmod(path, mode);
    if (res == -1 && (errno == EPERM || errno == ENOTSUP || errno == EOPNOTSUPP)) {
        return 0;
    }
    return res;
}

int fchmod(int fd, mode_t mode) {
    if (!real_fchmod) real_fchmod = (int (*)(int, mode_t))dlsym(RTLD_NEXT, "fchmod");
    int res = real_fchmod(fd, mode);
    if (res == -1 && (errno == EPERM || errno == ENOTSUP || errno == EOPNOTSUPP)) {
        return 0;
    }
    return res;
}

int fchmodat(int dirfd, const char *pathname, mode_t mode, int flags) {
    if (!real_fchmodat) real_fchmodat = (int (*)(int, const char *, mode_t, int))dlsym(RTLD_NEXT, "fchmodat");
    int res = real_fchmodat(dirfd, pathname, mode, flags);
    if (res == -1 && (errno == EPERM || errno == ENOTSUP || errno == EOPNOTSUPP)) {
        return 0;
    }
    return res;
}