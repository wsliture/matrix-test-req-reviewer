import {useEffect, useState} from "react";
import {Alert, Button, Form, Input, message, Modal, Space, Spin, Tabs} from "antd";
import {useMutation, useQuery, useQueryClient} from "@tanstack/react-query";
import {useNavigate} from "react-router-dom";
import {api, type CurrentUser} from "./api";

export type SettingsTab = "password" | "users" | "opencode";

export function SettingsModal({open, activeTab, user, onTabChange, onClose, beforeLeave}: {
    open: boolean;
    activeTab: SettingsTab;
    user?: CurrentUser;
    onTabChange: (tab: SettingsTab) => void;
    onClose: () => void;
    beforeLeave?: () => boolean
}) {
    const queryClient = useQueryClient(), navigate = useNavigate(), [passwordForm] = Form.useForm(),
        [userForm] = Form.useForm(), [configContent, setConfigContent] = useState("");
    const configQuery = useQuery({
        queryKey: ["opencode-config"],
        queryFn: () => api<{content: string}>("/settings/opencode"),
        enabled: open && activeTab === "opencode" && user?.role === "ADMIN"
    });
    const changePassword = useMutation({
        mutationFn: (values: {currentPassword: string; newPassword: string}) => api("/auth/change-password", {
            method: "POST", body: JSON.stringify(values)
        }),
        onSuccess: () => {
            message.success("密码修改成功，请重新登录");
            queryClient.setQueryData(["me"], null);
            navigate("/login", {replace: true})
        }
    });
    const createUser = useMutation({
        mutationFn: (values: {username: string; password: string}) => api<{
            id: string;
            username: string;
            role: string;
            createdAt: string
        }>("/settings/users", {method: "POST", body: JSON.stringify(values)}),
        onSuccess: result => {
            userForm.resetFields();
            message.success(`用户“${result.username}”已创建`)
        }
    });
    const saveConfig = useMutation({
        mutationFn: () => api<{content: string}>("/settings/opencode", {
            method: "PUT", body: JSON.stringify({content: configContent})
        }),
        onSuccess: result => {
            setConfigContent(result.content);
            queryClient.setQueryData(["opencode-config"], result);
            message.success("OpenCode配置已保存并生效")
        }
    });
    useEffect(() => {
        if (configQuery.data?.content) setConfigContent(configQuery.data.content)
    }, [configQuery.data?.content]);
    const items = [{
        key: "password", label: "修改密码", children: <Form form={passwordForm} layout="vertical"
            onFinish={values => {
                if (!beforeLeave || beforeLeave()) changePassword.mutate({currentPassword: values.currentPassword, newPassword: values.newPassword})
            }}>
            <Form.Item name="currentPassword" label="当前密码" rules={[{required: true, message: "请输入当前密码"}]}><Input.Password/></Form.Item>
            <Form.Item name="newPassword" label="新密码" rules={[{required: true, message: "请输入新密码"},
                {min: 8, max: 128, message: "密码长度必须为8至128个字符"}]}><Input.Password/></Form.Item>
            <Form.Item name="confirmPassword" label="确认新密码" dependencies={["newPassword"]} rules={[{required: true, message: "请再次输入新密码"},
                ({getFieldValue}: any) => ({validator(_: unknown, value: string) {
                    return !value || getFieldValue("newPassword") === value ? Promise.resolve() : Promise.reject(new Error("两次输入的新密码不一致"))
                }})]}><Input.Password autoComplete="new-password"/></Form.Item>
            {changePassword.error && <Alert type="error" showIcon message={changePassword.error.message}/>}<Button
                type="primary" htmlType="submit" loading={changePassword.isPending}>修改密码</Button>
        </Form>
    }, ...(user?.role === "ADMIN" ? [{
        key: "users", label: "添加用户", children: <Form form={userForm} layout="vertical"
            onFinish={values => createUser.mutate({username: values.username.trim(), password: values.password})}>
            <Alert type="info" showIcon message="新用户将以评审人员身份创建，可使用项目创建、测试需求生成、评审和导出功能。"/>
            <Form.Item name="username" label="用户名" rules={[{required: true, whitespace: true, message: "请输入用户名"},
                {max: 64, message: "用户名不能超过64个字符"}]}><Input autoComplete="off" placeholder="请输入用户名"/></Form.Item>
            <Form.Item name="password" label="初始密码" rules={[{required: true, message: "请输入初始密码"},
                {min: 8, max: 128, message: "密码长度必须为8至128个字符"}]}><Input.Password autoComplete="new-password"/></Form.Item>
            <Form.Item name="confirmPassword" label="确认初始密码" dependencies={["password"]} rules={[{required: true, message: "请再次输入初始密码"},
                ({getFieldValue}: any) => ({validator(_: unknown, value: string) {
                    return !value || getFieldValue("password") === value ? Promise.resolve() : Promise.reject(new Error("两次输入的密码不一致"))
                }})]}><Input.Password/></Form.Item>
            {createUser.isSuccess && <Alert type="success" showIcon closable message={`用户“${createUser.data.username}”创建成功`}
                description="该用户现在可以使用初始密码登录系统。" onClose={() => createUser.reset()}/>}
            {createUser.error && <Alert type="error" showIcon message={createUser.error.message}/>}<Button
                type="primary" htmlType="submit" loading={createUser.isPending}>创建用户</Button>
        </Form>
    }, {
        key: "opencode", label: "OpenCode配置", children: <div><Alert type="warning" showIcon
            message="配置中可能包含明文API Key，仅管理员可以查看和修改。保存时会自动保留Matrix插件。"/>
            {configQuery.isLoading ? <Spin/> : <><Input.TextArea className="opencode-config-editor" rows={20}
                value={configContent} onChange={event => setConfigContent(event.target.value)} spellCheck={false}/>
                {configQuery.error && <Alert type="error" showIcon message={configQuery.error.message}/>}
                {saveConfig.error && <Alert type="error" showIcon message={saveConfig.error.message}/>}<Space>
                    <Button onClick={() => {
                        try {
                            setConfigContent(JSON.stringify(JSON.parse(configContent), null, 2) + "\n")
                        } catch {
                            message.error("当前内容不是合法JSON")
                        }
                    }}>格式化JSON</Button><Button type="primary" loading={saveConfig.isPending}
                                              onClick={() => saveConfig.mutate()}>保存并应用</Button>
                </Space></>}
        </div>
    }] : [])];
    return <Modal open={open} title="设置" width={760} footer={null} destroyOnHidden onCancel={onClose}>
        <Tabs activeKey={activeTab} onChange={key => onTabChange(key as SettingsTab)} items={items}/>
    </Modal>
}
