"use client";

import { motion } from "motion/react";

import { cn } from "@/lib/utils";

import * as icons from "./icons";

const EASE = [0.16, 1, 0.3, 1] as const;
const iconList = Object.values(icons);

export const Hero = () => (
  <section className="hero mt-16">
    <motion.div
      className="flex items-center gap-3"
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: EASE }}
    >
      <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-foreground">
        Files SDK
      </h1>
    </motion.div>
    <motion.p
      className="text-muted-foreground text-balance leading-relaxed"
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.12, duration: 0.6, ease: EASE }}
    >
      A unified storage SDK for object and blob backends. One small, honest API.
      Web-standards I/O. An escape hatch when you need the native client.
    </motion.p>
    <div className="flex items-center -space-x-0.5">
      {iconList.map((Icon, index) => {
        const restRotate = index % 2 === 0 ? 3 : -3;
        return (
          <motion.div
            key={Icon.name}
            initial={{ opacity: 0, rotate: 0, scale: 0.6, y: -10 }}
            animate={{
              opacity: 1,
              rotate: restRotate,
              scale: 1,
              transition: {
                delay: 0.05 * index,
                duration: 0.5,
                ease: EASE,
              },
              y: 0,
            }}
            transition={{ duration: 0.3, ease: EASE }}
            whileHover={{ rotate: restRotate, scale: 1.05, y: -4 }}
          >
            <Icon
              className={cn("size-6 rounded-sm ring-2 ring-background block")}
            />
          </motion.div>
        );
      })}
    </div>
  </section>
);
