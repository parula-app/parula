#include <jni.h>
#include <node.h>

using namespace std;

// Copy arguments from JNI to C++ format
char** argsJavaToC(JNIEnv *env, jsize argc, jobjectArray args) {
    char** argv = new char*[argc];

    for (int i = 0; i < argc; i++) {
        auto arg = (jstring)env->GetObjectArrayElement(args, i);
        // Returns the length of the UTF8 byte stream, in bytes.
        // ! `GetStringLength()` returns the Unicode chars and is unsuitable for array allocation
        jsize argSize = env->GetStringUTFLength(arg);


        argv[i] = new char[argSize + 1];

        // Copy argument to argv directly and release reference automatically
        // <https://developer.android.com/ndk/guides/jni-tips#region-calls>
        env->GetStringUTFRegion(arg, 0, argSize, argv[i]);
        // Append null terminator needed by C++
        argv[i][argSize] = '\0';

        // Always to remove the reference
        env->DeleteLocalRef(arg);
    }

    return argv;
}

jint startNode(JNIEnv *env,
               jobject /* this */,
               jobjectArray args) {

    jsize argc = env->GetArrayLength(args);
    char** argv = argsJavaToC(env, argc, args);

    printf("Starting node in C++ with %d arguments\n", argc);
    int exitCode = node::Start(argc, argv);
    printf("Node process exited with code %d\n", exitCode);

    for (int i = 0; i < argc; i++) {
        delete[] argv[i];
    }
    delete[] argv;

    return jint(exitCode);
}

// Called by System.loadLibrary("node-process")
// Registers native methods in the Kotlin class without
// letting the JNI find them which is much faster.
// <https://developer.android.com/ndk/guides/jni-tips#native-libraries>
JNIEXPORT jint JNI_OnLoad(JavaVM* vm, void* reserved) {
    JNIEnv* env;
    if (vm->GetEnv(reinterpret_cast<void**>(&env), JNI_VERSION_1_6) != JNI_OK) {
        return JNI_ERR;
    }

    // Find the NodeProcess class
    jclass c = env->FindClass("im/mustang/capa/nodeprocess/NodeProcess");
    if (c == nullptr) return JNI_ERR;

    // Register your class' native methods.
    static const JNINativeMethod methods[] = {
            {"startNode", "([Ljava/lang/String;)I", (jint*)(startNode)},
    };

    int rc = env->RegisterNatives(c, methods, sizeof(methods)/sizeof(JNINativeMethod));
    if (rc != JNI_OK) return rc;

    return JNI_VERSION_1_6;
}
