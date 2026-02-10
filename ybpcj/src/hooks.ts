import { DashboardState, dashboard } from "@lark-base-open/js-sdk";
import React from "react";
import { useLayoutEffect, useState } from "react";

/**
 * 更新主题模式
 */
function updateTheme(theme: string) {
  document.body.setAttribute('theme-mode', theme);
}

/**
 * 跟随主题色变化
 * 适配仪表盘全屏状态下的深色模式
 */
export function useTheme() {
  const [bgColor, setBgColor] = useState('#ffffff');

  useLayoutEffect(() => {
    // 获取初始主题
    dashboard.getTheme().then((res) => {
      setBgColor(res.chartBgColor);
      updateTheme(res.theme.toLocaleLowerCase());
    });

    // 监听主题变化
    dashboard.onThemeChange((res) => {
      setBgColor(res.data.chartBgColor);
      updateTheme(res.data.theme.toLocaleLowerCase());
    });
    // 注意：该 SDK 版本的 onThemeChange 不返回清理函数
  }, []);

  return {
    bgColor,
  };
}

/**
 * 初始化、更新配置
 * 遵循飞书仪表盘插件配置规范
 * - Create 状态：不可调用 getConfig
 * - Config/View 状态：可以调用 getConfig 和监听 onConfigChange
 */
export function useConfig(updateConfig: (data: any) => void) {
  const isCreate = dashboard.state === DashboardState.Create;

  React.useEffect(() => {
    // 创建状态不能获取配置
    if (isCreate) {
      return;
    }

    // 初始化获取配置
    dashboard.getConfig().then(updateConfig).catch((error) => {
      console.error('[useConfig] 获取配置失败:', error);
    });
  }, [isCreate, updateConfig]);

  React.useEffect(() => {
    // 创建状态不需要监听配置变化
    if (isCreate) {
      return;
    }

    // 监听配置变化，支持协同编辑
    dashboard.onConfigChange((r) => {
      console.log('[useConfig] 配置发生变更:', r.data);
      updateConfig(r.data);
    });
    // 注意：该 SDK 版本的 onConfigChange 不返回清理函数
  }, [isCreate, updateConfig]);
}
